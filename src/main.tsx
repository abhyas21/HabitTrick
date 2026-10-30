import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

if (!Capacitor.isNativePlatform()) registerSW({ immediate: true })
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
