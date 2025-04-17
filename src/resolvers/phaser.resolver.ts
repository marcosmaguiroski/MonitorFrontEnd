import { Injectable, inject } from '@angular/core';
import { Resolve } from '@angular/router';
import { ApiService, PhaserData } from '../services/phaser.service';
import { catchError, forkJoin, of, tap, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PhaserResolver implements Resolve<void> {
  private readonly apiService = inject(ApiService);

  resolve() {
    const defaultData = this.createDefaultData();
    
    const loadPhaser = (id: number) => 
      this.apiService.getPhaser(id).pipe(
        catchError(error => this.handlePhaserError(id, error, defaultData))
      );

    return forkJoin([
      loadPhaser(0),
      loadPhaser(1)
    ]).pipe(
      tap(([phaser0, phaser1]) => this.updatePhaserData(phaser0, phaser1)),
      map(() => undefined) // Corrige o tipo de retorno para void
    );
  }

  private createDefaultData(): PhaserData {
    return {
      voltage: 0,
      current: 0,
      frequency: 0,
      bird_on_bath: 0,
      phaserId: 0
    };
  }

  private handlePhaserError(id: number, error: unknown, defaultData: PhaserData) {
    this.apiService.handleApiError(error, `Carregamento do Phaser ${id}`);
    this.apiService.getSignalUpdater(id)(defaultData);
    return of(defaultData);
  }

  private updatePhaserData(...phasers: PhaserData[]): void {
    phasers.forEach((data, index) => 
      this.apiService.getSignalUpdater(index)(data)
    );
  }
}