import { Injectable, inject, signal, WritableSignal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, timer, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap, timeout, retry, distinctUntilChanged, tap } from 'rxjs/operators';

export interface PhaserData {
  voltage: number | null;
  frequency: number | null;
  current: number | null;
  bird_on_bath: number;
  phaserId: number;
  ipAddress?: string;
}

export enum PhaserErrorCode {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  TIMEOUT = 'TIMEOUT',
  INVALID_DATA = 'INVALID_DATA',
  UNKNOWN = 'UNKNOWN'
}

export interface PhaserError {
  code: PhaserErrorCode;
  message: string;
  timestamp: number;
}

export interface DeviceInfo {
  ipAddress: string;
  macAddress: string;
  softwareVersion: string;
  localDateTime: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly phaserCache = new Map<number, PhaserData>();

  // Configurações
  readonly apiUrl =
    window.location.hostname === 'localhost'
      ? 'http://localhost:5000/api'
      : '/api';
  readonly requestTimeout = 2000; // 2 segundos
  readonly maxRetries = 3;

  // Signals
  public readonly phaser0Data: WritableSignal<PhaserData | null> = signal(null);
  public readonly phaser1Data: WritableSignal<PhaserData | null> = signal(null);
  public readonly errors = signal<PhaserError[]>([]);

  /**
   * Obtém dados em tempo real do phaser especificado
   * @param phaserId - ID do phaser (0 ou 1)
   * @param intervalMs - Intervalo de atualização em milissegundos
   * @returns Observable com os dados atualizados
   */
  getRealtimePhaserData(
    index: number,
    interval: number
  ): Observable<PhaserData> {
    return this.http.get<PhaserData>(`${this.apiUrl}/Phaser/${index}`).pipe(
      catchError((error: HttpErrorResponse) => {
        // Trata respostas malformadas (status 200 mas corpo inválido)
        if (error.error instanceof ErrorEvent || error.status === 200) {
          return throwError(() => ({
            name: 'InvalidResponseError',
            message: 'Resposta da API malformada',
            status: error.status,
          }));
        }
        return throwError(() => error);
      })
    );
  }

  public getPhaser(phaserId: number): Observable<PhaserData> {
    const url = `${this.apiUrl}/Phaser/${phaserId}`;
    return this.http.get<PhaserData>(url).pipe(
      timeout({ each: this.requestTimeout }),
      map((data) => this.validatePhaserData(data)),
      tap((validData) => this.updateCacheAndSignal(phaserId, validData)),
      catchError((error) => {
        console.error(`[ERRO] Phaser ${phaserId}:`, error);
        return this.handleGetPhaserError(phaserId, error);
      })
    );
  }

  /**
   * Atualiza o endereço IP do phaser
   * @param phaserId - ID do phaser (0 ou 1)
   * @param newIp - Novo endereço IP
   * @throws {Error} Se o IP for inválido
   */
  updatePhaserIp(phaserId: number, newIp: string): Observable<any> {
    if (!this.isValidIp(newIp)) {
      const error = this.createApiError(
        'Endereço IP inválido',
        PhaserErrorCode.INVALID_DATA
      );
      this.errors.update((errors) => [...errors, error]);
      return throwError(() => error);
    }

    return this.http
      .put(
        `${this.apiUrl}/phaser/${phaserId}`,
        { ipAddress: newIp },
        { headers: new HttpHeaders({ 'Content-Type': 'application/json' }) }
      )
      .pipe(
        tap(() => this.phaserCache.delete(phaserId)),
        catchError((error) =>
          this.handleApiError(error, `Atualização do Phaser ${phaserId}`)
        )
      );
  }

  getPhaserConfigurations(): Observable<any> {
    return this.http.get(`${this.apiUrl}/Phaser/all`).pipe(
      timeout({ each: this.requestTimeout }),
      catchError((error) =>
        this.handleApiError(error, 'Obtenção das configurações')
      )
    );
  }

  /**
   * Obtém informações do dispositivo
   * @returns Observable com informações normalizadas do dispositivo
   */
  getDeviceInfo(): Observable<DeviceInfo> {
    return this.http.get<DeviceInfo>(`${this.apiUrl}/SystemInfo`).pipe(
      timeout({ each: this.requestTimeout }),
      map((response) => this.normalizeDeviceInfo(response)),
      catchError((error) =>
        this.handleApiError(error, 'Informações do dispositivo')
      )
    );
  }

  private normalizeDeviceInfo(response: DeviceInfo): DeviceInfo {
    return {
      ipAddress: response.ipAddress || '0.0.0.0',
      macAddress: response.macAddress || '00:00:00:00:00:00',
      softwareVersion: response.softwareVersion || '1.0.0',
      localDateTime: response.localDateTime || new Date().toISOString(),
    };
  }

  private updateCacheAndSignal(phaserId: number, data: PhaserData): void {
    if (
      !this.phaserCache.has(phaserId) ||
      !this.comparePhaserData(this.phaserCache.get(phaserId)!, data)
    ) {
      this.phaserCache.set(phaserId, data);
      this.getSignalUpdater(phaserId)(data);
    }
  }

  public getSignalUpdater(phaserId: number): (value: PhaserData) => void {
    return phaserId === 0 ? this.phaser0Data.set : this.phaser1Data.set;
  }

  private isPhaserData(data: any): data is PhaserData {
    return (
      typeof data === 'object' &&
      ['voltage', 'current', 'frequency', 'bird_on_bath'].every(
        (field) => field in data
      )
    );
  }

  private validatePhaserData(data: unknown): PhaserData {
    if (!this.isPhaserData(data)) {
      throw this.createApiError(
        'Estrutura de dados inválida',
        PhaserErrorCode.INVALID_DATA
      );
    }

    return {
      voltage: Number(data.voltage),
      current: Number(data.current),
      frequency: Number(data.frequency),
      bird_on_bath: Number(data.bird_on_bath),
      phaserId: data.phaserId ?? 0,
    };
  }

  private comparePhaserData(a: PhaserData, b: PhaserData): boolean {
    return (
      a.voltage === b.voltage &&
      a.current === b.current &&
      a.frequency === b.frequency &&
      a.bird_on_bath === b.bird_on_bath
    );
  }

  private handleGetPhaserError(
    phaserId: number,
    error: unknown
  ): Observable<PhaserData> {
    const cached = this.phaserCache.get(phaserId);
    if (cached) return of(cached);

    const apiError = this.createApiError(
      `Erro na conexão: ${this.getErrorMessage(error)}`,
      PhaserErrorCode.CONNECTION_ERROR
    );
    return throwError(() => apiError);
  }

  public handleApiError(error: unknown, context: string): Observable<never> {
    const apiError = this.createApiError(
      `${context}: ${this.getErrorMessage(error)}`,
      this.getErrorCode(error)
    );

    this.errors.update((errors) => [...errors, apiError]);
    return throwError(() => apiError);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Erro desconhecido';
  }

  private getErrorCode(error: unknown): PhaserErrorCode {
    if (error instanceof HttpErrorResponse) {
      switch (error.status) {
        case 0:
          return PhaserErrorCode.CONNECTION_ERROR; // Sem conexão
        case 504:
          return PhaserErrorCode.TIMEOUT; // Gateway Timeout
        case 400:
          return PhaserErrorCode.INVALID_DATA; // Bad Request
        default:
          return PhaserErrorCode.UNKNOWN;
      }
    }
    return PhaserErrorCode.UNKNOWN;
  }

  private createApiError(message: string, code: PhaserErrorCode): PhaserError {
    return {
      code,
      message,
      timestamp: Date.now(),
    };
  }

  isValidIp(ip: string): boolean {
    try {
      new URL(`http://${ip}`);
      return true;
    } catch {
      return false;
    }
  }

  clearOldErrors(): void {
    this.errors.update((errors) =>
      errors.filter((e) => Date.now() - e.timestamp < 3_600_000)
    );
  }
}
