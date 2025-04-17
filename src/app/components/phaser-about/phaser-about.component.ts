import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NetworkService } from '../../../services/network.service';
import { ApiService } from '../../../services/phaser.service';
import { Subscription, timer, Subject, of, interval, BehaviorSubject } from 'rxjs';
import { switchMap, catchError, takeUntil } from 'rxjs/operators';
import { MatError } from '@angular/material/form-field';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

interface DeviceInfo {
  ipAddress: string;
  softwareVersion: string;
  macAddress: string;
  dateTime: string;
}

@Component({
  selector: 'app-device-info',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatError,
    MatDialogModule
    
  ],
  templateUrl: './phaser-about.component.html',
  styleUrls: ['./phaser-about.component.css']
})
export class PhaserAboutComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private snackBar = inject(MatSnackBar);
  protected networkService = inject(NetworkService);

  // Estados do componente
  deviceInfo: DeviceInfo = this.createEmptyDeviceInfo();
  loading = true;
  currentTime = '';
  isOnline = false;
  networkError = false;
  apiError = false;
  
  // Status de conexão reativo
  statusText$ = new BehaviorSubject<string>('Carregando...');

  // Gerenciamento de subscrições
  private destroy$ = new Subject<void>();
  private dataSubscription!: Subscription;

  ngOnInit(): void {
    this.startMonitoring();
    this.setupTimeUpdates();
    this.checkInitialState();
  }

  private startMonitoring(): void {
    interval(1000).pipe(
      switchMap(() => this.apiService.getDeviceInfo()),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (info) => {
        this.updateDeviceInfo(info);
        this.apiError = false;
      },
      error: (error) => {
        this.handleApiError(error);
      }
    });
  }
  

  private checkInitialState(): void {
    if (this.networkService.isOnline()) {
      this.handleOnline();
    } else {
      this.handleOffline();
    }
  }

  private setupTimeUpdates(): void {
    interval(1000).pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.updateDateTime();
    });
  }

  private handleOnline(): void {
    if (this.dataSubscription) return;

    this.loading = true;
    this.apiError = false;
    this.statusText$.next('Conectado');

    this.dataSubscription = timer(0, 30000).pipe(
      switchMap(() => this.apiService.getDeviceInfo().pipe(
        catchError(error => {
          this.handleApiError(error);
          return of(null);
        })
      )),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (info) => {
        if (info) {
          this.updateDeviceInfo(info);
          this.apiError = false;
        }
        this.loading = false;
        this.statusText$.next('Conectado');
      },
      error: (error) => {
        this.handleApiError(error);
        this.loading = false;
        this.statusText$.next('Erro ao obter informações');
      }
    });
  }

  private handleOffline(): void {
    this.loading = false;
    this.networkError = true;
    this.statusText$.next('Offline - Sem conexão com o dispositivo');

    this.deviceInfo = {
      ...this.deviceInfo,
      ipAddress: 'Erro ao obter IP'
    };

    this.dataSubscription?.unsubscribe();
  }

  private updateDateTime(): void {
    this.currentTime = new Date().toLocaleString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    this.deviceInfo.dateTime = this.currentTime;
  }

  private createEmptyDeviceInfo(): DeviceInfo {
    return {
      ipAddress: 'Carregando...',
      softwareVersion: '1.0.0',
      macAddress: '00:00:00:00:00:00',
      dateTime: this.currentTime
    };
  }

  private updateDeviceInfo(info: any): void {
    this.deviceInfo = {
      ipAddress: info?.ipAddress === '0.0.0.0' ? 'Sem conexão com o dispositivo' : info?.ipAddress || 'Não disponível',
      softwareVersion: info?.softwareVersion || '1.0.0',
      macAddress: info?.macAddress || '00:00:00:00:00:00',
      dateTime: this.currentTime
    };
    this.statusText$.next(info?.ipAddress === '0.0.0.0' ? 'Offline - Verifique sua conexão de internet' : 'Conectado');
  }

  private handleApiError(error: any): void {
    this.apiError = true;
    this.statusText$.next('Erro ao obter informações');
    this.snackBar.open('Erro ao obter informações do servidor', 'Fechar', {
      duration: 3000
    });
  }

  get displayIP(): string {
    return this.networkError
      ? 'Erro ao obter IP'
      : this.deviceInfo.ipAddress || 'Carregando...';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.dataSubscription?.unsubscribe();
  }
}
