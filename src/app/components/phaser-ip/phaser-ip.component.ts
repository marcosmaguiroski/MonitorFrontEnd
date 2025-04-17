import { Component, Inject, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors, AbstractControlOptions, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../../services/phaser.service';
import { lastValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { LocalStorageService } from '../../../services/local-storage.service';

export interface PhaserIpData {
  phaser0: PhaserConfig;
  phaser1: PhaserConfig;
}

export interface PhaserConfig {
  id: number;
  ip: string;
}

@Component({
  selector: 'app-phaser-ip',
  standalone: true,
  imports: [
    MatDialogModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './phaser-ip.component.html',
  styleUrls: ['./phaser-ip.component.css'],
})
export class PhaserIpComponent implements OnInit {
  private fb = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private apiService = inject(ApiService);
  private localStorageService = inject(LocalStorageService);
  private dialogRef = inject(MatDialogRef<PhaserIpComponent>);

  private storageKey = 'phaser_ip_config';
  public initialData: PhaserIpData;

  loading = false;
  errorMessage = '';
  form: FormGroup;

  constructor(@Inject(MAT_DIALOG_DATA) initialData: PhaserIpData) {
    // Armazena os dados iniciais para comparação posterior
    this.initialData = initialData;

    // Configura o formulário com valores padrão
    this.form = this.createFormWithFallback();
  }

  ngOnInit(): void {
    this.loadInitialData();
  }

  private createFormWithFallback(): FormGroup {
    const ipRegex =
      '^((25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$';

    return this.fb.group(
      {
        phaser0Ip: ['', [Validators.pattern(ipRegex)]],
        phaser1Ip: ['', [Validators.pattern(ipRegex)]],
      },
      { validators: this.atLeastOneValidator } as AbstractControlOptions
    );
  }

  private async loadInitialData(): Promise<void> {
    this.loading = true;

    try {
      // 1. Tenta carregar do Local Storage primeiro
      const savedData = this.localStorageService.get(this.storageKey);

      // Se existir no Local Storage, usa esses dados
      if (savedData) {
        this.initialData = savedData;
        this.form.patchValue({
          phaser0Ip: savedData.phaser0.ip,
          phaser1Ip: savedData.phaser1.ip,
        });
        return;
      }

      // 2. Se não existir no Local Storage, usa os dados iniciais passados ou cria padrão
      let fallbackData = this.initialData || this.createDefaultData();

      // 3. Tenta carregar da API (para cada phaser)
      const [phaser0Data, phaser1Data] = await Promise.all([
        this.tryLoadPhaserData(0, fallbackData.phaser0.ip),
        this.tryLoadPhaserData(1, fallbackData.phaser1.ip),
      ]);

      // Combina todos os dados
      const finalData: PhaserIpData = {
        phaser0: { id: 0, ip: phaser0Data || fallbackData.phaser0.ip },
        phaser1: { id: 1, ip: phaser1Data || fallbackData.phaser1.ip },
      };

      // Salva no Local Storage para uso futuro
      this.localStorageService.set(this.storageKey, finalData);

      this.initialData = finalData;
      this.form.patchValue({
        phaser0Ip: finalData.phaser0.ip,
        phaser1Ip: finalData.phaser1.ip,
      });
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
      this.snackBar.open(
        'Erro ao carregar configurações. Usando valores padrão.',
        'Fechar',
        { duration: 3000 }
      );
      // Garante que pelo menos os dados padrão sejam usados
      const defaultData = this.createDefaultData();
      this.initialData = defaultData;
      this.form.patchValue({
        phaser0Ip: defaultData.phaser0.ip,
        phaser1Ip: defaultData.phaser1.ip,
      });
    } finally {
      this.loading = false;
    }
  }

  private createDefaultData(): PhaserIpData {
    return {
      phaser0: { id: 0, ip: '' },
      phaser1: { id: 1, ip: '' },
    };
  }

private async tryLoadPhaserData(phaserId: number, fallbackIp: string): Promise<string> {
  try {
    const response = await lastValueFrom(
      this.apiService.getPhaserConfigurations().pipe(
        map((allPhasers: any) => {
          const phaser = allPhasers.find((p: any) => p.phaserNumber === phaserId);
          return phaser?.ipAddress || fallbackIp;
        }),
        catchError(() => of(fallbackIp))
    ));
    return response;
  } catch (error) {
    return fallbackIp;
  }
}

  private atLeastOneValidator(
    control: AbstractControl
  ): ValidationErrors | null {
    const phaser0 = control.get('phaser0Ip')?.value?.trim();
    const phaser1 = control.get('phaser1Ip')?.value?.trim();
    return phaser0 || phaser1 ? null : { atLeastOneRequired: true };
  }



  async onSave() {
    if (this.form.invalid) {
      this.markAllAsTouched();
      this.snackBar.open('Verifique os campos inválidos', 'Fechar', {
        duration: 3000,
      });
      return;
    }

    const updates = this.prepareUpdates();
    if (updates.length === 0) {
      this.snackBar.open('Nenhuma alteração detectada', 'Fechar', {
        duration: 3000,
      });
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    try {
      const results = await this.sendUpdates(updates);
      this.handleSaveResults(results);
    } catch (error) {
      this.handleSaveError(error);
    } finally {
      this.loading = false;
    }
  }

  private markAllAsTouched(): void {
    Object.values(this.form.controls).forEach((control) => {
      control.markAsTouched();
    });
  }

  private prepareUpdates(): { id: number; ip: string }[] {
    const updates: { id: number; ip: string }[] = [];
    const formValue = this.form.value;

    if (formValue.phaser0Ip?.trim() !== this.initialData.phaser0.ip) {
      updates.push({
        id: this.initialData.phaser0.id,
        ip: formValue.phaser0Ip.trim(),
      });
    }

    if (formValue.phaser1Ip?.trim() !== this.initialData.phaser1.ip) {
      updates.push({
        id: this.initialData.phaser1.id,
        ip: formValue.phaser1Ip.trim(),
      });
    }

    return updates;
  }

  private async sendUpdates(updates: { id: number; ip: string }[]) {
    const updatePromises = updates.map(({ id, ip }) =>
      lastValueFrom(
        this.apiService.updatePhaserIp(id, ip).pipe(
          map(() => ({ success: true, id })),
          catchError(() => of({ error: `Falha no Phaser ${id + 1}` }))
        )
      )
    );

    return await Promise.all(updatePromises);
  }

  private handleSaveResults(results: any[]): void {
    const errors = results.filter((res) => 'error' in res);

    if (errors.length > 0) {
      this.errorMessage = errors.map((e) => e.error).join(', ');
      this.snackBar.open('Alguns IPs não foram atualizados', 'Fechar', {
        duration: 3000,
      });
    } else {
      const updatedData = this.buildUpdatedData();

      // Atualiza localmente e no Local Storage
      this.initialData = updatedData;
      this.localStorageService.set(this.storageKey, updatedData);

      this.snackBar.open('IPs atualizados com sucesso!', 'Fechar', {
        duration: 3000,
      });
      this.dialogRef.close(updatedData);
    }
  }

  private handleSaveError(error: any): void {
    console.error('Erro ao salvar:', error);
    this.errorMessage = 'Erro inesperado ao salvar configurações';
    this.snackBar.open('Erro ao salvar configurações', 'Fechar', {
      duration: 3000,
    });
  }

  private buildUpdatedData(): PhaserIpData {
    const formValue = this.form.value;

    return {
      phaser0: {
        id: this.initialData.phaser0.id,
        ip: formValue.phaser0Ip?.trim() || this.initialData.phaser0.ip,
      },
      phaser1: {
        id: this.initialData.phaser1.id,
        ip: formValue.phaser1Ip?.trim() || this.initialData.phaser1.ip,
      },
    };
  }

  onCancel() {
    this.dialogRef.close();
  }
}
