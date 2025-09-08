import styles from './App.module.scss'
import squadyLogo from './assets/squady.png'
export const App = () => {

  return (
    <div className={styles.container}>
      <SquadyUI />
    </div>
  )
}

const SquadyUI = () => {
  const text = 'Squady'
  return (
    <div className={styles.squadyUIContainer}>
      <div className={styles.squadyUI}>
        <img src={squadyLogo} alt="squady" />
      </div>
      <div className={styles.squadyUIText}>
        <div>{text}</div>
      </div>
    </div>
  )
}