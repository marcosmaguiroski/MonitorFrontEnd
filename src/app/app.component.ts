import { ChangeDetectorRef, Component } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer } from '@angular/platform-browser';
import { PhaserIpComponent, PhaserIpData } from './components/phaser-ip/phaser-ip.component';
import { PhaserConfigComponent } from './components/phaser-config/phaser-config.component';
import { PhaserAboutComponent } from './components/phaser-about/phaser-about.component';
import { MatDividerModule } from '@angular/material/divider';
import { RouterOutlet } from '@angular/router';
import { NetworkConfig } from '../services/network.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatToolbarModule,
    MatMenuModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    RouterOutlet
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  phaser0Data: PhaserIpData['phaser0'] = { id: 0, ip: '' };
  phaser1Data: PhaserIpData['phaser1'] = { id: 1, ip: '' };

  constructor(
    private dialog: MatDialog,
    private iconRegistry: MatIconRegistry,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {
    this.registerIcons();
  }
  ngOnInit(): void {
    //Gambi para corrigir um bug que só acontece no rasp/orange:
    //Depois da inicialização, o primeiro LOAD no home fica vazio, se sair para qualquer página e voltar pro home corrige
    //Mas preferi fazer desse jeito para recarregar a página depois da inicialização do sistema
    //Fiquem a vontade para corrigir isso
    if (!localStorage['hasStarted'] && ( window.location.hostname == 'localhost' )) {
      localStorage['hasStarted'] = true;
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  }
  private registerIcons(): void {
    // Ícones do menu (armazenados em assets/icons/)
    this.iconRegistry.addSvgIcon(
      'menu',
      this.sanitizer.bypassSecurityTrustResourceUrl('assets/icons/menu.svg')
    );
    this.iconRegistry.addSvgIcon(
      'settings',
      this.sanitizer.bypassSecurityTrustResourceUrl('assets/icons/settings.svg')
    );
    this.iconRegistry.addSvgIcon(
      'network_ping',
      this.sanitizer.bypassSecurityTrustResourceUrl('assets/icons/network_ping.svg')
    );
    this.iconRegistry.addSvgIcon(
      'question_mark',
      this.sanitizer.bypassSecurityTrustResourceUrl('assets/icons/question_mark.svg')
    );
  }

  openPhaserIpDialog(): void {
    const dialogRef = this.dialog.open(PhaserIpComponent, {
      width: '400px',
      data: { phaser0: { ...this.phaser0Data }, phaser1: { ...this.phaser1Data } }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.phaser0Data.ip = result.phaser0.ip;
        this.phaser1Data.ip = result.phaser1.ip;
      }
    });
  }

  openPhaserConfigDialog(): void {
    const dialogRef = this.dialog.open<PhaserConfigComponent, NetworkConfig, NetworkConfig>(
      PhaserConfigComponent,
      {
        width: '600px', // Aumentado para melhor visualização
        data: {
          dhcp: false,
          ipAddress: '',
          netMask: '',
          gateway: '',
          dnsPrimary: '',
          dnsSecondary: ''
        } as NetworkConfig
      }
    );

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        console.log('Network configuration updated:', result);
        // Adicione aqui lógica adicional se necessário
      }
    });
  }

  openPhaserAboutDialog(): void {
    this.dialog.open(PhaserAboutComponent, { 
      width: '600px',
      panelClass: 'about-dialog' 
    });
  }
}