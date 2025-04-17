import { Component, Inject, OnInit, effect, OnDestroy } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  FormControl,
  FormGroupDirective,
  NgForm,
  ReactiveFormsModule,
} from '@angular/forms';
import { ErrorStateMatcher } from '@angular/material/core';
import {
  MatDialogRef,
  MAT_DIALOG_DATA,
  MatDialogModule,
} from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInput, MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule } from '@angular/common';
import { LocalStorageService } from '../../../services/local-storage.service';
import { NetworkService } from '../../../services/network.service';
import { NetworkConfig } from '../../../models/network-config';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  retry,
  switchMap,
  take,
  takeUntil,
  filter,
  timeout,
} from 'rxjs/operators';
import { Observable, of, timer, Subscription, forkJoin } from 'rxjs';
import {
  HttpClient,
  HttpHeaders,
  HttpErrorResponse,
} from '@angular/common/http';

export class MyErrorStateMatcher implements ErrorStateMatcher {
  isErrorState(
    control: FormControl | null,
    form: FormGroupDirective | NgForm | null
  ): boolean {
    return !!(control && control.invalid && (control.dirty || control.touched));
  }
}

@Component({
  selector: 'phaser-config',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './phaser-config.component.html',
  styleUrls: ['./phaser-config.component.css'],
})
export class PhaserConfigComponent implements OnInit, OnDestroy {
  form!: FormGroup;
  loading = true; // Estado geral de carregamento
  isSaving = false; // Novo estado para indicar salvamento
  matcher = new MyErrorStateMatcher();
  private storageKey = 'phaserConfig';
  private initialConfig: NetworkConfig | null = null;
  private redirectTimeout: number | null = null;
  private saveSubscription: Subscription | null = null;
  private isRedirecting = false;

  constructor(
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private localStorageService: LocalStorageService,
    private networkService: NetworkService,
    private http: HttpClient,
    public dialogRef: MatDialogRef<PhaserConfigComponent>,
    @Inject(MAT_DIALOG_DATA) public data: NetworkConfig
  ) {
    this.initializeFormWithFallback();
    this.setupAutoIpListener();
  }

  ngOnInit(): void {
    this.loadNetworkConfiguration();
    effect(() => {
      const currentConfig = this.networkService.networkConfig();
      if (currentConfig) {
        this.localStorageService.set(this.storageKey, currentConfig);
      }
    });
  }

  private initializeFormWithFallback(): void {
    const savedConfig = this.localStorageService.get(this.storageKey) || {};
    const fallbackData = {
      ...this.data,
      ...savedConfig,
    };
    this.form = this.fb.group({
      dhcp: [fallbackData.dhcp || false],
      ipAddress: [
        {
          value: fallbackData.ipAddress || '',
          disabled: fallbackData.dhcp,
        },
        [Validators.required, Validators.pattern(NetworkService.IP_PATTERN)],
      ],
      netMask: [
        {
          value: fallbackData.netMask || '',
          disabled: fallbackData.dhcp,
        },
        [
          Validators.required,
          Validators.pattern(NetworkService.IP_PATTERN),
          NetworkService.netmaskValidator(),
        ],
      ],
      gateway: [
        {
          value: fallbackData.gateway || '',
          disabled: fallbackData.dhcp,
        },
        [Validators.required, Validators.pattern(NetworkService.IP_PATTERN)],
      ],
      dnsPrimary: [
        {
          value: fallbackData.dnsPrimary || '',
          disabled: fallbackData.dhcp,
        },
        [Validators.required, Validators.pattern(NetworkService.IP_PATTERN)],
      ],
      dnsSecondary: [
        {
          value: fallbackData.dnsSecondary || '',
          disabled: fallbackData.dhcp,
        },
        [Validators.required, Validators.pattern(NetworkService.IP_PATTERN)],
      ],
    });
    this.networkService.toggleDhcpControls(this.form, fallbackData.dhcp);
  }

  private loadNetworkConfiguration(): void {
    this.networkService.getSystemNetworkInfo().subscribe({
      next: (value) => {
        this.form.controls['ipAddress'].setValue(value.ipAddress);
        this.form.controls['netMask'].setValue(value.networkMask);
        this.form.controls['gateway'].setValue(value.gateway);
        this.form.controls['dnsPrimary'].setValue(value.primaryDns);
        this.form.controls['dnsSecondary'].setValue(value.secondaryDns);
        this.form.controls['dhcp'].setValue(value.dhcp);
        this.loading = false; // Finaliza o carregamento inicial
      },
    });
  }

  private setupAutoIpListener(): void {
    this.form.get('dhcp')?.valueChanges.subscribe((dhcpEnabled) => {
      this.networkService.toggleDhcpControls(this.form, dhcpEnabled);
    });
  }

  private hasChanges(newConfig: NetworkConfig): boolean {
    return JSON.stringify(newConfig) !== JSON.stringify(this.initialConfig);
  }

  private buildNewUrl(ipAddress: string): string {
    return `${window.location.protocol}//${ipAddress}`;
  }

  private checkServerAvailability(url: string): Observable<boolean> {
    return this.http
      .get(`${url}/api/network/configuration`, {
        headers: new HttpHeaders({
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        }),
        responseType: 'json',
      })
      .pipe(
        timeout(10000),
        map(() => true),
        catchError((error) => {
          console.debug('Verificação de disponibilidade falhou:', error);
          return of(false);
        })
      );
  }

  private checkServerRepeatedly(url: string): Observable<boolean> {
    return timer(0, 2000).pipe(
      switchMap(() => this.checkServerAvailability(url)),
      takeUntil(timer(15000)),
      filter((available) => available),
      take(1),
      timeout(16000)
    );
  }

  onSave(): void {
    if (this.form.invalid) return;
    const networkConfig: NetworkConfig = {
      dhcp: this.form.value.dhcp,
      ipAddress: this.form.value.ipAddress,
      netMask: this.form.value.netMask,
      gateway: this.form.value.gateway,
      dnsPrimary: this.form.value.dnsPrimary,
      dnsSecondary: this.form.value.dnsSecondary,
    };
    if (!this.hasChanges(networkConfig)) {
      this.snackBar.open('Nenhuma alteração foi detectada', 'OK', {
        duration: 3000,
        panelClass: ['info-snackbar'],
      });
      return;
    }
    this.isSaving = true; // Define o estado de salvamento
    this.saveSubscription = this.networkService
      .updateNetworkConfig(networkConfig)
      .pipe(
        finalize(() => {
          this.isSaving = false; // Finaliza o estado de salvamento
        })
      )
      .subscribe({
        next: (updatedConfig) => {
          this.handleNetworkUpdate(updatedConfig);
        },
        error: (error) => {
          console.error('Erro ao salvar configuração:', error);
          this.showNetworkError(error);
        },
      });
  }

  private handleNetworkUpdate(updatedConfig: NetworkConfig): void {
    if (this.isSameConfiguration(updatedConfig)) {
      this.snackBar.open('Configuração já está em uso', 'OK', {
        duration: 3000,
        panelClass: ['info-snackbar'],
      });
      this.dialogRef.close(updatedConfig);
      return;
    }
    this.networkService.updateCurrentIp(updatedConfig.ipAddress);
    if (updatedConfig.dhcp) {
      this.handleDhcpChange();
    } else {
      this.handleStaticIpChange(updatedConfig);
    }
  }

  private isSameConfiguration(newConfig: NetworkConfig): boolean {
    if (!this.initialConfig) return false;
    return JSON.stringify(newConfig) === JSON.stringify(this.initialConfig);
  }

  private handleDhcpChange(): void {
    const currentUrl = this.buildNewUrl(window.location.hostname);
    const message = 'Configuração DHCP aplicada - reconectando...';
    const snackBarRef = this.snackBar.open(message, 'Cancelar', {
      panelClass: ['info-snackbar'],
      duration: 10000,
    });
    this.isRedirecting = true;
    this.redirectTimeout = window.setTimeout(() => {
      this.attemptRedirect(currentUrl);
    }, 5000);
    const sub = snackBarRef.onAction().subscribe(() => {
      this.cancelRedirect();
      sub.unsubscribe();
    });
    this.checkServerRepeatedly(currentUrl)
      .pipe(finalize(() => sub.unsubscribe()))
      .subscribe({
        next: (available) => {
          if (available) {
            this.attemptRedirect(currentUrl);
          }
        },
        error: (err) => {
          console.error('Erro na verificação DHCP:', err);
        },
      });
  }

  private handleStaticIpChange(updatedConfig: NetworkConfig): void {
    const newUrl = this.buildNewUrl(updatedConfig.ipAddress);
    const currentHost = window.location.hostname;
    if (this.isSameAddress(currentHost, updatedConfig.ipAddress)) {
      this.snackBar.open('Configuração aplicada (mesmo endereço)', 'OK', {
        duration: 3000,
        panelClass: ['info-snackbar'],
      });
      return;
    }
    const message = `Redirecionando...`;
    const snackBarRef = this.snackBar.open(message, 'Cancelar', {
      panelClass: ['info-snackbar'],
      duration: 15000,
    });
    this.isRedirecting = true;
    this.redirectTimeout = window.setTimeout(() => {
      this.attemptRedirect(newUrl);
    }, 8000);
    const sub = snackBarRef.onAction().subscribe(() => {
      this.cancelRedirect();
      sub.unsubscribe();
    });
    this.checkServerRepeatedly(newUrl)
      .pipe(finalize(() => sub.unsubscribe()))
      .subscribe({
        next: (available) => {
          if (available) {
            this.attemptRedirect(newUrl);
          }
        },
        error: (err) => {
          console.error('Erro na verificação de IP estático:', err);
        },
      });
  }

  private isSameAddress(current: string, newAddress: string): boolean {
    return (
      current === newAddress ||
      (current === 'localhost' && newAddress === '127.0.0.1') ||
      (current === '127.0.0.1' && newAddress === 'localhost')
    );
  }

  private attemptRedirect(url: string): void {
    if (!this.isRedirecting) return;
    if (this.redirectTimeout) {
      clearTimeout(this.redirectTimeout);
      this.redirectTimeout = null;
    }
    this.checkServerAvailability(url).subscribe({
      next: (available) => {
        if (available) {
          window.location.href = url;
        }
      },
      error: () => {},
    });
  }

  private cancelRedirect(): void {
    this.isRedirecting = false;
    if (this.redirectTimeout) {
      clearTimeout(this.redirectTimeout);
      this.redirectTimeout = null;
    }
    this.snackBar.open('Redirecionamento cancelado', 'OK', {
      duration: 3000,
    });
  }

  private showNetworkError(error: any): void {
    let errorMessage = 'Falha ao salvar configurações';
    if (error instanceof HttpErrorResponse) {
      errorMessage += ` (${error.status}: ${error.statusText})`;
    }
    this.snackBar.open(errorMessage, 'Fechar', {
      duration: 5000,
      panelClass: ['error-snackbar'],
    });
  }

  ngOnDestroy(): void {
    this.isRedirecting = false;
    if (this.redirectTimeout) {
      window.clearTimeout(this.redirectTimeout);
      this.redirectTimeout = null;
    }
    if (this.saveSubscription) {
      this.saveSubscription.unsubscribe();
      this.saveSubscription = null;
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
