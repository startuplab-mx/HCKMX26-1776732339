import type { KeywordRule } from './contracts';
import { CATEGORY_DEFINITIONS, type KeywordCategory } from './risk-categories';

const makeRule = (
  id: string,
  value: string,
  mappedCategory: KeywordCategory,
  signalType: KeywordRule['signalType'],
  aliases: readonly string[] = [],
): KeywordRule => ({
  id,
  value,
  aliases,
  mappedCategory,
  signalType,
  baseSeverity: CATEGORY_DEFINITIONS[mappedCategory].defaultSeverity,
  confidence: signalType === 'emoji' ? 0.7 : 0.85,
});

export const RISK_INDICATOR_RULES: readonly KeywordRule[] = [
  makeRule('illicit-01', 'premio por hacer', 'illicitRewardPromise', 'word', ['te doy premio']),
  makeRule('mission-01', 'misiones', 'missionRecruitment', 'word', ['mision', 'encargo']),
  makeRule('personal-01', 'en que escuela estudias', 'personalInformation', 'word', ['nombre completo']),
  makeRule('financial-01', 'numero de tarjeta', 'financialData', 'word', ['cvv', 'cuenta bancaria']),
  makeRule('migration-01', 'pasate a telegram', 'platformMigrationEvasion', 'word', ['pasate a discord']),
  makeRule('sextortion-01', 'manda foto', 'sextortionPhotoRequest', 'word', ['prende la camara']),
  makeRule('strangers-01', 'nos vemos en', 'meetingStrangers', 'word', ['ven al parque']),
  makeRule('deepfake-01', 'video manipulado', 'deepfakesMisinformation', 'word', ['noticia falsa']),
  makeRule('malware-01', 'descarga hack', 'hacksMalwareDownload', 'word', ['dinero infinito']),
  makeRule('spam-01', 'spam', 'spamHarassmentMessages', 'word', ['mensajes sin sentido']),
  makeRule('selfharm-01', 'autolesion', 'selfHarmSuicide', 'word', ['suicidio']),
  makeRule('threat-01', 'te voy a matar', 'directThreat', 'word', ['amenaza directa']),

  makeRule('hash-01', '#letras', 'missionRecruitment', 'hashtag', ['#cjng']),
  makeRule('hash-02', '#lachapiza', 'missionRecruitment', 'hashtag', ['#gentedelmz']),
  makeRule('hash-03', '#trabajoparalamana', 'missionRecruitment', 'hashtag', ['#trabajoparalamaña']),
  makeRule('hash-04', '#belicos', 'meetingStrangers', 'hashtag', ['#belicones']),
  makeRule('hash-05', '#operativamz', 'directThreat', 'hashtag'),
  makeRule('hash-06', '#frasesbelicas', 'directThreat', 'hashtag'),
  makeRule('hash-07', '#ondeado', 'hacksMalwareDownload', 'hashtag'),

  makeRule('emoji-01', '🍕', 'missionRecruitment', 'emoji'),
  makeRule('emoji-02', '🐓', 'missionRecruitment', 'emoji'),
  makeRule('emoji-03', '🥷', 'directThreat', 'emoji'),
  makeRule('emoji-04', '🪖', 'directThreat', 'emoji'),
  makeRule('emoji-05', '🧿', 'deepfakesMisinformation', 'emoji'),
  makeRule('emoji-06', '😈', 'directThreat', 'emoji'),
  makeRule('emoji-07', '💀', 'directThreat', 'emoji'),
];
