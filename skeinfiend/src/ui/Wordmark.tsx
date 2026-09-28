import styles from './wordmark.module.css'

/** The name as SkeinFiend writes it: Pirata One, a simplified blackletter, a touch larger than its size to sit even with the text around it. */
export function Wordmark({ size = '1.35rem' }: { size?: string }) {
  return (
    <span className={styles.wordmark} style={{ fontSize: `calc(${size} * 1.12)` }}>
      SkeinFiend
    </span>
  )
}
