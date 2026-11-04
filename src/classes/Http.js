import axios from "axios";
import { fetch } from '@tauri-apps/plugin-http';

class Http {
    // Callers that need status/headers (e.g. ETag/304) handle errors themselves.
    static getResponse(url, config = {}) {
        return axios.get(url, { timeout: 30000, ...config })
    }
    static async get(url, config = { timeout: 30000 }) {
        try {
            const res = await axios.get(url, config)
            return res.data
        }
        catch (err){
            console.log(err);
        }
    }
    static async post(url, data, config = { timeout: 30000 }) {
        try {
            const res = await axios.post(url, data, config)
            return res.data
        }
        catch (err){
            console.log(err);
        }
    }
    static async tauriGet(url, config = {
        connectTimeout: 30000
    }) {
        try {
            const res = await fetch(url, {
                method: 'GET',
                ...config
            })
            const data = await res.json()
            return data
        } catch (e) {
            console.log(e);
        }
    }
}

export default Http;
