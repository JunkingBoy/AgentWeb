import styles from './RouteFallback.module.css'

/**
 * 路由懒加载 chunk 下载/解析期间的占位加载态。
 * 保持轻量、无第三方依赖，避免与懒加载目标互相拖累。
 */
export default function RouteFallback() {
  return (
    <div className={styles.page}>
      <div className={styles.spinner} />
      <p className={styles.text}>加载中...</p>
    </div>
  )
}
