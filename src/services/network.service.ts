import { Injectable, signal, computed, effect } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, tap, timeout } from 'rxjs/operators';
import { Observable, throwError, of } from 'rxjs';
import { AbstractControl, FormGroup, ValidatorFn } from '@angular/forms';

// Interface para tipagem das configurações
export interface NetworkConfig {
  dhcp: boolean;
  ipAddress: string;
  netMask: string;
  gateway: string;
  dnsPrimary: string;
  dnsSecondary: string;
}

// Interface para as informações do sistema
export interface SystemNetworkInfo {
  ipAddress: string;
  networkMask: string;
  gateway: string;
  primaryDns: string;
  secondaryDns: string;
  macAddress?: string;
  softwareVersion?: string;
  localDateTime?: string;
  dhcp: boolean;
}

@Injectable({ providedIn: 'root' })
export class NetworkService {
  static readonly IP_PATTERN = '^((25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$';
  readonly apiUrl = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000/api' 
  : '/api';
  static netmaskValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const validMasks = [
        '255.255.255.0', '255.255.0.0', '255.0.0.0',
        '255.255.255.128', '255.255.255.192', '255.255.255.224',
        '255.255.255.240', '255.255.255.248', '255.255.255.252',
        '255.255.255.254'
      ];
      return validMasks.includes(control.value) ? null : { invalidNetmask: true };
    };
  }

  // Signals para estado da rede
  private onlineSignal = signal(navigator.onLine);
  private networkConfigSignal = signal<NetworkConfig | null>(null);
  private loadingSignal = signal(false);
  private currentIpSignal = signal<string>('');

  // Computed values
  public isOnline = computed(() => this.onlineSignal());
  public isOffline = computed(() => !this.onlineSignal());
  public networkConfig = computed(() => this.networkConfigSignal());
  public isLoading = computed(() => this.loadingSignal());
  public currentIp = computed(() => this.currentIpSignal());

  // Referência do snackbar
  private snackBarRef: any;

  constructor(
    private snackBar: MatSnackBar,
    private http: HttpClient
  ) {
    this.setupNetworkListeners();
    this.setupOfflineNotifications();
  }

  // ========== Métodos de Configuração de Rede ==========
  getNetworkConfig(): Observable<NetworkConfig> {
    this.loadingSignal.set(true);
    return this.http.get<NetworkConfig>(`${this.apiUrl}/network/configuration`).pipe(
      timeout(15000), // 15 segundos
      catchError(error => {
        this.loadingSignal.set(false);
        if (error.name === 'TimeoutError') {
          this.showNotification('Dispositivo não respondeu a tempo', 'Fechar', true);
        }
        return throwError(() => error);
      })
    );
  }

  updateNetworkConfig(config: NetworkConfig): Observable<NetworkConfig> {
    this.loadingSignal.set(true);
    return this.http.put<NetworkConfig>('/api/network/configuration', config).pipe(
      tap(updatedConfig => {
        this.networkConfigSignal.set(updatedConfig);
        this.showNotification('Configuração atualizada com sucesso!');
        this.loadingSignal.set(false);
      }),
      catchError(this.handleError.bind(this))
    );
  }

  getSystemNetworkInfo(): Observable<SystemNetworkInfo> {
    this.loadingSignal.set(true);
    return this.http.get<SystemNetworkInfo>(`${this.apiUrl}/systeminfo`).pipe(
      timeout(5000),
      tap(() => this.loadingSignal.set(false)),
      catchError(error => {
        this.loadingSignal.set(false);
        console.error('Erro ao obter informações de rede:', error);
        // Retorna um objeto completo com valores padrão
        return of({
          ipAddress: '',
          networkMask: '',
          gateway: '',
          primaryDns: '',
          secondaryDns: '',
          macAddress: '00:00:00:00:00:00',
          softwareVersion: '1.0.0',
          localDateTime: new Date().toISOString(),
          dhcp: false
        });
      })
    );
  }
  public toggleDhcpControls(form: FormGroup, dhcpEnabled: boolean): void {
    const controls = ['ipAddress', 'netMask', 'gateway', 'dnsPrimary', 'dnsSecondary'];
    controls.forEach(control => {
      const formControl = form.get(control);
      dhcpEnabled ? formControl?.disable() : formControl?.enable();
    });
  }

  // Método para atualizar o IP
  public updateCurrentIp(ip: string): void {
    this.currentIpSignal.set(ip);
  }

  // ========== Helpers ==========
  private handleError(error: HttpErrorResponse) {
    this.loadingSignal.set(false);
    let errorMessage = 'Erro desconhecido';
    
    if (error.error instanceof ErrorEvent) {
      // Erro do cliente
      errorMessage = `Erro: ${error.error.message}`;
    } else {
      // Erro do servidor
      errorMessage = `Código: ${error.status}\nMensagem: ${error.message}`;
    }
    
    this.showNotification(errorMessage, 'Fechar', true);
    return throwError(() => new Error(errorMessage));
  }

  private showNotification(
    message: string, 
    action: string = 'Fechar', 
    isError: boolean = false
  ) {
    this.snackBarRef?.dismiss();
    this.snackBarRef = this.snackBar.open(message, action, {
      duration: isError ? 5000 : 3000,
      panelClass: isError ? 'error-snackbar' : 'success-snackbar'
    });
  }

  // ========== Implementação Existente ==========
  private setupNetworkListeners(): void {
    const updateOnlineStatus = () => {
      this.onlineSignal.set(navigator.onLine);
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
  }

  private setupOfflineNotifications(): void {
    effect(() => {
      if (this.isOffline()) {
        this.showNotification('Erro de conexão: Verifique sua conexão com a internet', 'Fechar', true);
      }
    });
  }
}