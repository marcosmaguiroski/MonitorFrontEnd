// network-config.ts
export interface NetworkConfig {
    dhcp: boolean;
    ipAddress: string;
    netMask: string;
    gateway: string;
    dnsPrimary: string;
    dnsSecondary: string;
  }
