export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number]; // LOW, MEDIUM, HIGH, CRITICAL (LOW is the least severe, CRITICAL is the most severe)

export type Severity = RiskLevel;

export const RISK_COLORS = ['GREEN', 'YELLOW', 'RED'] as const;
export type RiskColor = (typeof RISK_COLORS)[number]; // input: RiskLevel, output: RiskColor (GREEN, YELLOW, RED)

export const KEYWORD_CATEGORIES = [
  'illicitRewardPromise',
  'missionRecruitment',
  'personalInformation',
  'financialData',
  'platformMigrationEvasion',
  'sextortionPhotoRequest',
  'meetingStrangers',
  'deepfakesMisinformation',
  'hacksMalwareDownload',
  'spamHarassmentMessages',
  'selfHarmSuicide',
  'directThreat',
] as const;

export type KeywordCategory = (typeof KEYWORD_CATEGORIES)[number];

// Definition of a keyword category, it is used to define the category of a keyword rule
export interface CategoryDefinition {
  id: KeywordCategory;
  labelEs: string;
  defaultSeverity: Severity;
  defaultColor: RiskColor;
}

export const CATEGORY_DEFINITIONS: Readonly<Record<KeywordCategory, CategoryDefinition>> = {
  illicitRewardPromise: {
    id: 'illicitRewardPromise',
    labelEs: 'Promesa de premios por accion ilicita',
    defaultSeverity: 'LOW',
    defaultColor: 'GREEN',
  },
  missionRecruitment: {
    id: 'missionRecruitment',
    labelEs: 'Reclutamiento por misiones',
    defaultSeverity: 'MEDIUM',
    defaultColor: 'YELLOW',
  },
  personalInformation: {
    id: 'personalInformation',
    labelEs: 'Informacion personal',
    defaultSeverity: 'LOW',
    defaultColor: 'GREEN',
  },
  financialData: {
    id: 'financialData',
    labelEs: 'Datos financieros',
    defaultSeverity: 'HIGH',
    defaultColor: 'RED',
  },
  platformMigrationEvasion: {
    id: 'platformMigrationEvasion',
    labelEs: 'Cambio a plataformas con menos filtros',
    defaultSeverity: 'LOW',
    defaultColor: 'GREEN',
  },
  sextortionPhotoRequest: {
    id: 'sextortionPhotoRequest',
    labelEs: 'Peticion de fotos comprometedoras',
    defaultSeverity: 'HIGH',
    defaultColor: 'RED',
  },
  meetingStrangers: {
    id: 'meetingStrangers',
    labelEs: 'Encontrarse con desconocidos',
    defaultSeverity: 'HIGH',
    defaultColor: 'RED',
  },
  deepfakesMisinformation: {
    id: 'deepfakesMisinformation',
    labelEs: 'Deepfakes e informacion falsa',
    defaultSeverity: 'MEDIUM',
    defaultColor: 'YELLOW',
  },
  hacksMalwareDownload: {
    id: 'hacksMalwareDownload',
    labelEs: 'Descarga de hacks y malware',
    defaultSeverity: 'LOW',
    defaultColor: 'GREEN',
  },
  spamHarassmentMessages: {
    id: 'spamHarassmentMessages',
    labelEs: 'Mensajes extranos / spam',
    defaultSeverity: 'MEDIUM',
    defaultColor: 'YELLOW',
  },
  selfHarmSuicide: {
    id: 'selfHarmSuicide',
    labelEs: 'Autolesion / suicidio',
    defaultSeverity: 'HIGH',
    defaultColor: 'RED',
  },
  directThreat: {
    id: 'directThreat',
    labelEs: 'Amenaza directa',
    defaultSeverity: 'HIGH',
    defaultColor: 'RED',
  },
};

export const riskLevelToColor = (riskLevel: RiskLevel): RiskColor => {
  if (riskLevel === 'LOW') {
    return 'GREEN';
  }

  if (riskLevel === 'MEDIUM') {
    return 'YELLOW';
  }

  return 'RED';
};
