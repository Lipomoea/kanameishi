import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import L from 'leaflet'

import App from './App.vue'
import router from './router'

import axios from 'axios'

axios.defaults.timeout = 30000
L.Tooltip.mergeOptions({ opacity: 0.8 })

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
