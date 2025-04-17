import { Routes } from '@angular/router';
import { PhaserIpComponent } from './components/phaser-ip/phaser-ip.component';
import { PhaserDashboardComponent } from './components/phaser-dashboard/phaser-dashboard.component';
import { PhaserConfigComponent } from './components/phaser-config/phaser-config.component';
import { PhaserAboutComponent } from './components/phaser-about/phaser-about.component';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: PhaserDashboardComponent }, // Página "Dashboard"
  { path: 'phaser-ip', component: PhaserIpComponent }, // Página "Alterar IP"
  { path: 'phaser-config', component: PhaserConfigComponent }, // Página "Configuração"
  { path: 'phaser-about', component: PhaserAboutComponent }, // Página "Sobre o dispositivo"
];