/**
 * 消耗权重的颜色分档：0 免费（绿）、打折（主色）、基准 1 倍（灰）、加价（警告色）。
 *
 * 只影响观感，不参与任何计费/筛选判断 —— 分档本身一律走
 * `shared/channels.ts::costBucketOf`，颜色只跟着它变。
 *
 * 模型管理页与路由编辑器共用这一份：同一个倍率在两处显示成不同颜色，
 * 会让人以为哪一边算错了。
 */
export function weightTone(weight: number): string {
  if (weight === 0) return 'text-success'
  if (weight < 1) return 'text-primary'
  if (weight === 1) return 'text-muted-foreground'
  return 'text-warning'
}