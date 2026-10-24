/** Brand tokens. Everything visual lives here so the identity stays consistent. */
export const BRAND = {
  name: '人生选择指南',
  shortName: '选择指南',
  englishName: 'LIFECOURSE',
  /** Core theme line, echoed on the entry page and the exported long image. */
  theme: '男怕选错行，女怕嫁错郎',
  subline: '24 道题，看清你的性格底色与适合的职业方向',
  version: '1.0',
  /** Douyin / Xiaohongshu safe words: this is entertainment, not a diagnosis. */
  disclaimer:
    '本测评为娱乐与自我探索参考，基于你的作答偏好生成描述性画像，不具备任何心理诊断或医疗意义。如你正经历持续的困扰，请寻求专业心理工作者的帮助。',
  paymentNotice: '本测评为付费内容，购买后请妥善保管密码。密码可在有效期内使用指定次数。',
} as const;

export const PALETTE = {
  cream: '#FBF6EE',
  creamDeep: '#F3E9DA',
  card: '#FFFCF7',
  orange: '#D2762F',
  orangeSoft: '#F0C79B',
  orangeWash: '#FBEAD9',
  brown: '#3A2E26',
  brownSoft: '#6B5749',
  brownMuted: '#9A8878',
  line: '#E7D9C6',
  ink: '#241C16',
  accentGreen: '#5F7A55',
} as const;

/** Decorative geometry used by the entry page and export card. */
export const DECOR = {
  arcs: [
    { cx: 84, cy: 18, r: 46 },
    { cx: 22, cy: 74, r: 34 },
    { cx: 96, cy: 88, r: 26 },
  ],
} as const;