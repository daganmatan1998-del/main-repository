import type { QualityMode } from '../project/types';

export interface QualityProfile {
  label: string;
  description: string;
  maxDpr: number;
  shadowMapSize: number;
  msaaSamples: number;
  fxaa: boolean;
  ambientOcclusion: boolean;
  anisotropy: number;
}

export const QUALITY: Record<QualityMode, QualityProfile> = {
  performance: {
    label: 'Performance',
    description: 'Native resolution, light shadows, FXAA.',
    maxDpr: 1,
    shadowMapSize: 1024,
    msaaSamples: 0,
    fxaa: true,
    ambientOcclusion: false,
    anisotropy: 4,
  },
  balanced: {
    label: 'Balanced',
    description: 'HiDPI up to 1.5×, 2K soft shadows, 4× MSAA.',
    maxDpr: 1.5,
    shadowMapSize: 2048,
    msaaSamples: 4,
    fxaa: false,
    ambientOcclusion: false,
    anisotropy: 8,
  },
  ultra: {
    label: 'Ultra',
    description: 'Full HiDPI, 4K shadows, 4× MSAA, ground-truth ambient occlusion.',
    maxDpr: 2,
    shadowMapSize: 4096,
    msaaSamples: 4,
    fxaa: false,
    ambientOcclusion: true,
    anisotropy: 16,
  },
};
