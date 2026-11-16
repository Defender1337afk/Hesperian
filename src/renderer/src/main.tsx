import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startBoot } from './boot'
import './styles.css'
import './launcher.css'
import './polish.css'
import './bloom.css'

createRoot(document.getElementById('root')!).render(<App />)
void startBoot()
