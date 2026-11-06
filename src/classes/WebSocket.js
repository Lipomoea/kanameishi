const retryIntervals = [1000, 2000, 5000, 10000, 30000]

class WebSocketObj {
    constructor(urls, autoMessages = [], initMessages = [...autoMessages], { resetRetryOnOpen = true, autoSendInterval = 30000 } = {}) {
        if (typeof (urls) == 'string') urls = [urls]
        this.urls = urls
        this.urlIndex = 0
        this.url = this.urls[this.urlIndex]
        this.autoMessages = autoMessages
        this.initMessages = initMessages
        this.resetRetryOnOpen = resetRetryOnOpen
        this.shouldConnect = true
        this.autoSendInterval = autoSendInterval
        this.retryIndex = 0
        this.socket = new WebSocket(this.url)
        this.setupWebSocket()
    }
    async sendMessages(messages, sendMessage = msg => this.send(msg)) {
        const currentSocket = this.socket
        for (const msg of messages) {
            if (!this.shouldConnect || currentSocket != this.socket || currentSocket.readyState != 1) return
            sendMessage(msg)
            await new Promise(resolve => setTimeout(resolve, Math.min(this.autoSendInterval / messages.length, 2000)))
        }
    }
    setupWebSocket() {
        clearInterval(this.msgTimer)
        this.connectTimer = setTimeout(() => {
            if (this.socket.readyState == 0) this.socket.close()
        }, 10000);
        this.socket.onopen = () => {
            this.notifyState()
            this.sendMessages(this.initMessages)
            if (this.resetRetryOnOpen) this.resetRetryInterval()
            clearTimeout(this.connectTimer)
            if (this.autoMessages.length > 0) {
                this.msgTimer = setInterval(() => this.sendMessages(this.autoMessages), this.autoSendInterval)
            }
        }
        this.socket.onclose = event => this.retryAfterFailure(event)
        if (this.messageHandler)
            this.socket.onmessage = this.messageHandler
    }
    setMessageHandler(handler) {
        this.messageHandler = this.socket.onmessage = handler
    }
    setCloseHandler(handler) {
        this.closeHandler = handler
    }
    setStateHandler(handler) {
        this.stateHandler = handler
        this.notifyState()
    }
    notifyState(readyState = this.socket ? this.socket.readyState : 4) {
        if (this.stateHandler) this.stateHandler(readyState, this.urlIndex)
    }
    resetRetryInterval() {
        this.retryIndex = 0
    }
    retryAfterFailure(event) {
        if (!this.shouldConnect || this.reconnectTimer != null) return
        clearInterval(this.msgTimer)
        clearTimeout(this.connectTimer)
        // A failed authentication and the ensuing close must schedule only one retry.
        if (this.socket) {
            this.socket.onopen = null
            this.socket.onclose = null
            this.socket.onerror = null
            this.socket.onmessage = null
            this.socket.close()
        }
        if (this.closeHandler) this.closeHandler(event)
        if (!this.shouldConnect) return
        if (this.retryIndex === retryIntervals.length - 1) {
            this.urlIndex = (this.urlIndex + 1) % this.urls.length
            this.url = this.urls[this.urlIndex]
        }
        this.notifyState(3)
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            if (this.shouldConnect) this.reconnect()
        }, retryIntervals[this.retryIndex])
        this.retryIndex = Math.min(this.retryIndex + 1, retryIntervals.length - 1)
    }
    reconnect() {
        if (!this.shouldConnect) return
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        clearInterval(this.msgTimer)
        clearTimeout(this.connectTimer)
        if (this.socket) {
            this.socket.onopen = null
            this.socket.onclose = null
            this.socket.onerror = null
            this.socket.onmessage = null
            this.socket.close()
        }
        this.socket = new WebSocket(this.url)
        this.notifyState()
        this.setupWebSocket()
    }
    close() {
        this.shouldConnect = false
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        clearInterval(this.msgTimer)
        clearTimeout(this.connectTimer)
        if (this.socket) {
            this.socket.onopen = null
            this.socket.onclose = null
            this.socket.onerror = null
            this.socket.onmessage = null
            this.socket.close()
        }
        this.notifyState(3)
        if (this.closeHandler) this.closeHandler()
    }
    send(msg) {
        if (this.socket.readyState == 1) {
            this.socket.send(msg)
        }
    }
}

export default WebSocketObj

// Provider clients share the transport, but own their wire protocol.
class JsonWebSocketClient {
    constructor(urls, autoMessages = [], initMessages = autoMessages, options = {}) {
        this.transport = new WebSocketObj(urls, autoMessages, initMessages, options)
        this.transport.setMessageHandler(event => this.handleData(event.data))
        this.transport.setCloseHandler(event => this.handleClose(event))
    }
    get shouldConnect() { return this.transport.shouldConnect }
    setMessageHandler(handler) { this.messageHandler = handler }
    setCloseHandler(handler) { this.closeHandler = handler }
    setStateHandler(handler) { this.transport.setStateHandler(handler) }
    handleData(data) {
        let message
        try {
            message = JSON.parse(data)
        } catch {
            return
        }
        if (message && typeof message === 'object') this.handleMessage(message)
    }
    handleMessage(message) { this.messageHandler?.(message) }
    handleClose(event) { this.closeHandler?.(event) }
    close() { this.transport.close() }
}

export class WolfxClient extends JsonWebSocketClient {
    constructor(urls, sources) {
        super(urls, sources.map(source => source === 'ceaEew' ? 'query_cenceew' : `query_${source.toLowerCase()}`))
    }
}

export class P2pQuakeClient extends JsonWebSocketClient {
    constructor(urls) { super(urls, ['ping']) }
}

export class GlobalQuakeClient extends JsonWebSocketClient {
    constructor(urls) { super(urls, ['ping']) }
}

const lipoReportRequests = new Set(['cenc_report_list', 'cwa_report_list', 'kma_report_list', 'usgs_report_list'])
const lipoAuthenticationErrors = new Set(['AUTH_FAILED', 'PATH_FORBIDDEN'])
const lipoProtocolErrors = new Set([
    'AUTH_MESSAGE_INVALID', 'AUTH_MESSAGE_TOO_LARGE', 'REQUEST_FORBIDDEN',
    'unsupported request', 'report source unavailable', 'heartbeat reply required',
    'text messages required', 'invalid heartbeat JSON',
])

export class LipoApiClient extends JsonWebSocketClient {
    constructor(urls, { key, reportRequests = [], autoReconnectOnAuthFail = false, pews = false } = {}) {
        super(urls, [], [JSON.stringify({ type: 'auth', key })], { resetRetryOnOpen: false })
        this.authenticated = false
        this.ready = false
        this.pews = pews
        this.autoReconnectOnAuthFail = autoReconnectOnAuthFail
        this.reportRequests = [...new Set(reportRequests)].filter(type => lipoReportRequests.has(type))
        this.availableSources = new Set()
        this.pendingRequests = new Map()
        this.pendingListRefreshes = new Set()
    }
    handleMessage(message) {
        const { type, data } = message
        if (type === 'auth_ok') {
            this.authenticated = true
            this.lastError = null
            this.transport.resetRetryInterval()
        } else if (type === 'error') {
            this.lastError = data
            super.handleMessage(message)
            if (this.shouldStop(data?.code)) this.close()
            else this.transport.retryAfterFailure({ code: 0, reason: data?.code || '' })
            return
        } else if (!this.authenticated) {
            return
        } else if (type === 'heartbeat') {
            if (!this.pews && typeof data?.id === 'string' && data.id.length > 0) {
                this.transport.send(JSON.stringify({ type: 'heartbeat', data: { id: data.id } }))
            }
            return
        } else if (!this.pews && (type === 'init' || type === 'query_all')) {
            if (!data || typeof data !== 'object' || Array.isArray(data)) return
            this.availableSources = new Set(Object.keys(data))
            this.pendingRequests.delete(type)
            // Deliver the snapshot (including cenc_ir) before requesting report lists.
            super.handleMessage(message)
            if (type === 'init' && this.shouldConnect && this.authenticated) {
                this.ready = true
                this.requestBatch(this.reportRequests)
                clearInterval(this.queryTimer)
                this.queryTimer = setInterval(
                    () => this.requestBatch([...this.reportRequests, 'query_all']),
                    this.transport.autoSendInterval,
                )
            }
            return
        } else {
            this.pendingRequests.delete(type)
        }
        super.handleMessage(message)
        const reportList = `${type}_list`
        if (lipoReportRequests.has(reportList)) this.request(reportList, { refresh: true })
        else if (this.pendingListRefreshes.delete(type)) this.request(type)
    }
    requestBatch(types) {
        const requests = types.filter(type => type === 'query_all' || this.availableSources.has(type.replace(/_list$/, '')))
        // Check pending requests at send time, after the shared transport's stagger delay.
        return this.transport.sendMessages(requests, type => this.request(type))
    }
    request(type, { refresh = false } = {}) {
        if (!this.ready || !this.authenticated || this.pews || !this.shouldConnect) return
        if (type !== 'query_all' && (!this.reportRequests.includes(type) || !this.availableSources.has(type.replace(/_list$/, '')))) return
        const pendingSince = this.pendingRequests.get(type)
        if (pendingSince !== undefined && Date.now() - pendingSince < 30000) {
            // The in-flight snapshot may predate this push; refresh once it arrives.
            if (refresh) this.pendingListRefreshes.add(type)
            return
        }
        this.pendingListRefreshes.delete(type)
        this.pendingRequests.set(type, Date.now())
        this.transport.send(JSON.stringify({ type }))
    }
    shouldStop(code) {
        return lipoProtocolErrors.has(code)
            || (lipoAuthenticationErrors.has(code) && !this.autoReconnectOnAuthFail)
    }
    handleClose(event) {
        this.authenticated = false
        this.ready = false
        clearInterval(this.queryTimer)
        this.pendingRequests.clear()
        this.pendingListRefreshes.clear()
        if (!this.lastError && event?.reason && (lipoAuthenticationErrors.has(event.reason) || lipoProtocolErrors.has(event.reason))) {
            this.lastError = { code: event.reason, message: event.reason }
            super.handleMessage({ type: 'error', data: this.lastError })
        }
        if (event && this.shouldStop(event.reason)) {
            // The transport checks this flag before scheduling its next retry.
            this.transport.shouldConnect = false
            this.transport.notifyState(3)
        }
        super.handleClose(event)
    }
}
