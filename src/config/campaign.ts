/**
 * Campaign / marketing copy.
 */

export const SHARE_TEXT = {
  default: '我测出了我的性格原型，来看看你的：',
  title: '人生选择指南 · 我的结果',
} as const;

export const COPY_LINKS = {
  copy: '复制结果链接',
  copied: '链接已复制，去发给朋友吧',
  manualTitle: '手动复制链接',
  manualHint: '长按下面的链接，全选并复制',
  copiedFallback: '复制失败，请长按链接手动复制',
} as const;

export const SAVE_IMAGE = {
  button: '保存测评结果',
  generating: '正在生成长图…',
  shareFile: '分享图片',
  download: '下载 PNG',
  previewTitle: '长按图片保存到相册',
  previewHint: '部分浏览器不支持直接保存，请长按图片选择「保存到相册 / 存到手机」',
  failed: '长图生成失败了',
  retry: '再试一次',
  closePreview: '关闭预览',
  copiedFallback: '复制失败，请长按链接手动复制',
} as const;

export const QUOTA = {
  exhaustedTitle: '这个密码的测评次数已经用完了',
  exhaustedBody: '每个密码默认包含 3 次完整测评，你已经把三次都用完了。如果需要再测，可以联系店铺看看是否有新的密码。',
  invalidTitle: '密码不正确',
  invalidBody: '请检查密码是否输入正确，注意区分大小写和容易混淆的数字。如果确认无误，请联系购买渠道重新获取。',
  inactiveTitle: '这个密码已被停用',
  inactiveBody: '该密码当前不可用，请联系店铺确认一下。',
  rateLimitedTitle: '尝试次数过多',
  rateLimitedBody: '刚才输错太多次了，先休息一会儿再试。',
  networkTitle: '连接不上服务',
  networkBody: '请检查网络后重试。你已经输入过的密码不会被保存到本地以外的地方。',
  fallbackBody: '服务暂时不可用，请稍后再试。',
} as const;

export const RETAKE = {
  button: '再测一次',
  newQuota: '这个密码还有余额，新的测评已经开始',
  confirmTitle: '开始新一轮测评？',
  confirmBody: '你的 3 次额度中还有剩余次数。开始新的测评会消耗 1 次，上一次的结果和分享链接不会被覆盖。',
  confirmAction: '消耗 1 次额度，开始',
  cancel: '再想想',
} as const;