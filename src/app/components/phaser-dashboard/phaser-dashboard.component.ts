import { Component, OnInit, OnDestroy, signal, LOCALE_ID, inject, ChangeDetectionStrategy, effect } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { NgxGaugeModule } from 'ngx-gauge';
import { Subscription, interval, takeUntil, takeWhile, Subject, switchMap, of, timer, throwError } from 'rxjs';
import { catchError, timeout, finalize } from 'rxjs/operators';
import { CommonModule, DecimalPipe, registerLocaleData } from '@angular/common';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { ApiService, PhaserData } from '../../../services/phaser.service';
import { NetworkService } from '../../../services/network.service';
import localePt from '@angular/common/locales/pt';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';

registerLocaleData(localePt, 'pt-BR');

interface ErrorResponse {
  error: string;
}

type PhaserResponse = PhaserData | ErrorResponse;

@Component({
  selector: 'app-phaser-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    NgxGaugeModule,
    MatGridListModule,
    MatCardModule,
    MatProgressBarModule,
    MatToolbarModule,
    MatIconModule,
    MatMenuModule,
    MatSnackBarModule,
    RouterOutlet,
  ],
  providers: [
    NetworkService,
    DecimalPipe,
    ApiService,
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],
  templateUrl: './phaser-dashboard.component.html',
  styleUrls: ['./phaser-dashboard.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhaserDashboardComponent implements OnInit, OnDestroy {
  // ========== CONSTANTS ==========
  private readonly PHASER_COUNT = 2;
  private readonly REQUEST_INTERVAL = 1000; // Intervalo de 1 segundo para atualizações
  private readonly RECONNECT_INTERVAL = 1000; // Intervalo de 1 segundo para reconexão
  private readonly REQUEST_TIMEOUT = 2000; // Timeout reduzido para 2 segundos
  private readonly STABILITY_THRESHOLD = 3000; // 3 segundos sem resposta = instável

  private readonly GAUGE_COLORS = {
    offline: '#CCCCCC',
    deviceOffline: '#FF5252',
    online: '#FD7E14',
    unstable: '#FFA500',
  };

  // ========== SIGNALS ==========
  gaugeSize = signal(300);
  phaserData = signal<PhaserData[]>(this.initializePhaserData());
  errorMessages = signal<string[]>(Array(this.PHASER_COUNT).fill(''));
  showCurrent = signal<boolean[]>([true, true]);
  isOnline = signal(navigator.onLine);
  deviceStatus = signal<boolean[]>(Array(this.PHASER_COUNT).fill(false));
  connectionStability = signal<number[]>(Array(this.PHASER_COUNT).fill(100));
  lastSuccessfulUpdate = signal<number[]>(Array(this.PHASER_COUNT).fill(0));
  private isSnackBarOpen = signal(false);

  // ========== PRIVATE PROPERTIES ==========
  private subscriptions: Subscription[] = [];
  private isPageVisible = true;
  private snackBarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;
  private destroy$ = new Subject<void>();
  private router = inject(Router);
  private lastResponseTimes = Array(this.PHASER_COUNT).fill(0);

  constructor(
    private apiService: ApiService,
    private decimalPipe: DecimalPipe,
    private snackBar: MatSnackBar,
    private breakpointObserver: BreakpointObserver,
    private networkService: NetworkService
  ) {
    effect(() => {
      console.log('Dados atualizados:', this.phaserData());
    });
  }

  // ========== LIFECYCLE HOOKS ==========
  ngOnInit(): void {
    this.setupEventListeners();
    this.initializePhasers();
    this.setupResponsiveDesign();
    this.startConnectionMonitor();
  }

  ngOnDestroy(): void {
    this.cleanupEventListeners();
    this.cleanupSubscriptions();
    this.destroy$.next();
    this.destroy$.complete();
    this.closeSnackBar();
  }

  // ========== PUBLIC METHODS ==========
  getCurrentValue(index: number): number {
    if (!this.shouldShowData(index)) return 0;

    const data = this.phaserData()[index];
    const current = data.current ?? 0; // Trata null
    const birdOnBath = data.bird_on_bath || 1; // Evita divisão por zero

    return this.showCurrent()[index] ? current : (current / birdOnBath) * 1000;
  }

  formatValue(
    value: number | null | undefined,
    isCurrent: boolean = false // Parâmetro opcional
  ): string {
    if (value === null || value === undefined || isNaN(value)) return '--';
    if (value === 0) return '0';

    // Formatação condicional para corrente
    return isCurrent && value < 10
      ? this.decimalPipe.transform(value, '1.2-2') || '0.00'
      : this.decimalPipe.transform(value, '1.0-0') || '0';
  }

  toggleCurrentDisplay(index: number): void {
    this.showCurrent.update((show) => {
      const newShow = [...show];
      newShow[index] = !newShow[index];
      return newShow;
    });
  }

  isDeviceOffline(index: number): boolean {
    return !this.deviceStatus()[index];
  }

  shouldShowData(index: number): boolean {
    return this.isOnline() && this.deviceStatus()[index];
  }

  getGaugeColor(index: number): string {
    if (!this.isOnline()) return this.GAUGE_COLORS.offline;
    if (this.isDeviceOffline(index)) return this.GAUGE_COLORS.deviceOffline;

    const stability = this.connectionStability()[index];
    if (stability < 70) return this.GAUGE_COLORS.unstable;

    return this.GAUGE_COLORS.online;
  }

  getConnectionQuality(index: number): string {
    const stability = this.connectionStability()[index];
    if (stability > 80) return 'Excelente';
    if (stability > 60) return 'Boa';
    if (stability > 40) return 'Instável';
    return 'Ruim';
  }

  getLastUpdateTime(index: number): string {
    const lastUpdate = this.lastSuccessfulUpdate()[index];
    if (!lastUpdate) return 'Nunca';

    const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
    if (seconds < 60) return `${seconds} segundos atrás`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutos atrás`;
    return `${Math.floor(seconds / 3600)} horas atrás`;
  }

  goToPhaserIp(): void {
    this.router.navigate(['/phaser-ip']);
  }

  // ========== PRIVATE METHODS ==========
  private initializePhaserData(): PhaserData[] {
    return Array.from({ length: this.PHASER_COUNT }, () =>
      this.resetPhaserData()
    );
  }

  private initializePhasers(): void {
    for (let i = 0; i < this.PHASER_COUNT; i++) {
      this.startPhaserUpdates(i);
    }
  }

  private startConnectionMonitor(): void {
    interval(1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.checkConnectionStability();
      });
  }

  private checkConnectionStability(): void {
    if (!this.isOnline()) return;

    const now = Date.now();
    this.deviceStatus().forEach((status, index) => {
      if (status) {
        const timeSinceLastResponse = now - this.lastResponseTimes[index];
        const stability = Math.max(
          0,
          100 - (timeSinceLastResponse / this.STABILITY_THRESHOLD) * 100
        );
        this.updateConnectionStability(index, stability);

        // Verifica se a conexão foi perdida
        if (timeSinceLastResponse > this.STABILITY_THRESHOLD * 2) {
          this.handleHardwareDisconnect(index);
        }
      }
    });
  }

  private updateConnectionStability(index: number, value: number): void {
    this.connectionStability.update((stability) => {
      const updated = [...stability];
      updated[index] = value;
      return updated;
    });
  }

  private startPhaserUpdates(index: number): void {
    if (this.subscriptions[index]) {
      this.subscriptions[index].unsubscribe();
    }

    this.subscriptions[index] = timer(0, this.REQUEST_INTERVAL)
      .pipe(
        takeWhile(() => this.isPageVisible && this.isOnline()),
        switchMap(() =>
          this.apiService
            .getRealtimePhaserData(index, this.REQUEST_INTERVAL)
            .pipe(
              timeout(this.REQUEST_TIMEOUT),
              catchError((err) => {
                this.handleRequestError(index, err);
                return of(null);
              }),
              finalize(() => {
                // Sempre tenta reconectar, mesmo após erro
                if (!this.deviceStatus()[index] && this.isOnline()) {
                  setTimeout(
                    () => this.startPhaserUpdates(index),
                    this.RECONNECT_INTERVAL
                  );
                }
              })
            )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (data) => {
          if (data) {
            this.handleSuccessfulRequest(index, data);
          }
        },
        error: (err) => {
          this.handleRequestError(index, err);
        },
      });
  }

  private handleSuccessfulRequest(index: number, data: PhaserResponse): void {
    this.lastResponseTimes[index] = Date.now();
    this.lastSuccessfulUpdate.update((times) => {
      const updated = [...times];
      updated[index] = Date.now();
      return updated;
    });
    this.updateConnectionStability(index, 100);

    if (this.isErrorResponse(data)) {
      this.setDeviceError(index, data.error);
    } else {
      this.setDeviceOnline(index);
      this.updatePhaserState(index, data);
    }
  }

  private handleRequestError(index: number, error: any): void {
    console.error(`Erro no dispositivo ${index}:`, error);

    // Caso especial: resposta malformada (status 200 mas dados inválidos)
    if (error.name === 'InvalidResponseError') {
      this.setDeviceOffline(index, '⚠️ Sem conexão com o dispositivo');
      this.resetPhaserAtIndex(index); // <--- Limpa os dados!
      return;
    }

    const now = Date.now();
    const timeSinceLastResponse = now - this.lastResponseTimes[index];
    const stabilityScore = Math.max(
      0,
      100 - (timeSinceLastResponse / this.STABILITY_THRESHOLD) * 100
    );
    this.updateConnectionStability(index, stabilityScore);

    const errorMessage =
      error.name === 'TimeoutError'
        ? `⚠️ Dispositivo ${index + 1} não respondeu (timeout ${
            this.REQUEST_TIMEOUT / 1000
          }s)`
        : error.status === 0
        ? `⚠️ Conexão física perdida com o dispositivo ${index + 1}`
        : `⚠️ Erro no dispositivo ${
            index + 1
          }: Falha ao recuperar dados do equipamento`;

    this.setErrorState(index, errorMessage);
    this.setDeviceOffline(index, errorMessage);
  }

  private handleHardwareDisconnect(index: number): void {
    console.log(`⚠️ Conexão perdida com dispositivo ${index}`);

    this.phaserData.update((data) => {
      const updated = [...data];
      updated[index] = this.resetPhaserData();
      return updated;
    });

    this.setDeviceOffline(
      index,
      '⚠️ Dispositivo desconectado - Tentando reconectar...'
    );
  }

  private setupResponsiveDesign(): void {
    this.breakpointObserver
      .observe([Breakpoints.HandsetPortrait, Breakpoints.TabletPortrait])
      .pipe(takeUntil(this.destroy$))
      .subscribe((result) => {
        this.gaugeSize.set(
          result.matches
            ? result.breakpoints[Breakpoints.HandsetPortrait]
              ? 150
              : 175
            : 300
        );
      });
  }

  private setupEventListeners(): void {
    window.addEventListener('online', this.handleNetworkChange);
    window.addEventListener('offline', this.handleNetworkChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private cleanupEventListeners(): void {
    window.removeEventListener('online', this.handleNetworkChange);
    window.removeEventListener('offline', this.handleNetworkChange);
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
  }

  private handleNetworkChange = () => {
    const isNowOnline = navigator.onLine;
    this.isOnline.set(isNowOnline);

    if (isNowOnline) {
      this.errorMessages.set(Array(this.PHASER_COUNT).fill(''));
      this.restartAllPhasers();
    } else {
      this.setOfflineState();
    }
  };

  private handleVisibilityChange = () => {
    this.isPageVisible = !document.hidden;
    this.isPageVisible ? this.restartAllPhasers() : this.cleanupSubscriptions();
  };

  private setDeviceOnline(index: number): void {
    this.deviceStatus.update((status) => {
      const newStatus = [...status];
      newStatus[index] = true;
      return newStatus;
    });
    this.clearError(index);
    this.updateConnectionStability(index, 100);
  }

  private setDeviceOffline(index: number, message: string): void {
    this.deviceStatus.update((status) => {
      const newStatus = [...status];
      newStatus[index] = false;
      return newStatus;
    });
    this.setErrorState(index, message);
    this.updateConnectionStability(index, 0);
  }

  private setDeviceError(index: number, message: string): void {
    this.setDeviceOffline(index, message);
    this.resetPhaserAtIndex(index);
  }

  private updatePhaserState(index: number, data: PhaserData): void {
    this.phaserData.update((currentData) => {
      const updated = [...currentData];
      updated[index] = { ...data };
      return updated;
    });
  }

  private resetPhaserAtIndex(index: number): void {
    this.phaserData.update((data) => {
      const updated = [...data];
      updated[index] = this.resetPhaserData();
      return updated;
    });
  }

  private resetPhaserData(): PhaserData {
    return {
      voltage: null,
      current: null,
      frequency: null,
      bird_on_bath: 0,
      phaserId: 0,
    };
  }

  private setErrorState(index: number, message: string): void {
    this.errorMessages.update((messages) => {
      const updated = [...messages];
      updated[index] = message;
      return updated;
    });
    this.updateSnackbar();
  }

  private clearError(index: number): void {
    this.errorMessages.update((messages) => {
      const updated = [...messages];
      updated[index] = '';
      return updated;
    });
    this.updateSnackbar();
  }

  private setOfflineState(): void {
    this.deviceStatus.set(Array(this.PHASER_COUNT).fill(false));
    this.phaserData.set(this.initializePhaserData());
    this.errorMessages.set(
      Array(this.PHASER_COUNT).fill(
        '⚠️ Sem conexão com a internet. Verifique sua rede.'
      )
    );
    this.cleanupSubscriptions();
    this.showErrorSnackbar(
      '⚠️ Sem conexão com a internet. Verifique sua rede.'
    );
  }

  private restartAllPhasers(): void {
    if (!this.isOnline()) return;

    this.cleanupSubscriptions();
    this.deviceStatus.set(Array(this.PHASER_COUNT).fill(false));
    this.phaserData.set(this.initializePhaserData());
    this.initializePhasers();
  }

  private cleanupSubscriptions(): void {
    this.subscriptions.forEach((sub) => sub?.unsubscribe());
    this.subscriptions = [];
  }

  private updateSnackbar(): void {
    const messages = this.errorMessages().filter((msg) => !!msg);

    if (messages.length === 0) {
      this.closeSnackBar();
    } else if (!this.isSnackBarOpen()) {
      // Só abre se não estiver visível
      if (messages.length === this.PHASER_COUNT) {
        this.showErrorSnackbar(
          '⚠️ Dispositivos desconectados. Tentando reconectar...'
        );
      } else {
        this.showErrorSnackbar(messages.join(' | '));
      }
    }
  }

  private showErrorSnackbar(message: string): void {
    if (this.isSnackBarOpen()) return; // Não abre se já estiver visível

    this.snackBarRef?.dismiss();
    this.isSnackBarOpen.set(true); // Marca como aberto

    this.snackBarRef = this.snackBar.open(message, 'Tentar Novamente', {
      duration: undefined,
      panelClass: ['error-snackbar'],
    });

    this.snackBarRef.afterDismissed().subscribe(() => {
      this.isSnackBarOpen.set(false); // Reseta ao fechar
    });

    this.snackBarRef.onAction().subscribe(() => {
      this.restartAllPhasers();
    });
  }

  private closeSnackBar(): void {
    this.snackBarRef?.dismiss();
    this.snackBarRef = null;
    this.isSnackBarOpen.set(false);
  }

  private isErrorResponse(data: PhaserResponse): data is ErrorResponse {
    return typeof (data as ErrorResponse).error === 'string';
  }
}
