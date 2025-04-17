import { PhaserData, PhaserError } from "../services/phaser.service";


export interface PhaserStatus {
  loading: boolean;
  lastUpdate: Date;
  phaserNumber: number;
  ipAddress: string;
  timestamp: Date;
  data?: PhaserData;
  error?: PhaserError;
}
