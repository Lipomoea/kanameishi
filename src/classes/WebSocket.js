class WebSocketObj {
    constructor(urls, autoMessages = [], initMessages = [...autoMessages], { resetRetryOnOpen = true } = {}) {
        if (typeof (urls) == 'string') urls = [urls]
        this.urls = urls
        this.urlIndex = 0
        this.url = this.urls[this.urlIndex]
        this.autoMessages = autoMessages
        this.initMessages = initMessages
        this.resetRetryOnOpen = resetRetryOnOpen
        this.shouldConnect = true
        this.minRetryInterval = 3000
        this.maxRetryInterval = 10000
        this.autoSendInterval = 10000
        this.retryInterval = this.minRetryInterval
        this.socket = new WebSocket(this.url)
        this.setupWebSocket()
    }
    async sendMessages(messages) {
        const currentSocket = this.socket
        for (const msg of messages) {
            if (currentSocket != this.socket || currentSocket.readyState != 1) return
            this.send(msg)
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
        this.socket.onclose = () => this.retryAfterFailure()
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
        this.retryInterval = this.minRetryInterval
    }
    retryAfterFailure() {
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
        if (this.closeHandler) this.closeHandler()
        if (!this.shouldConnect) return
        if (this.retryInterval >= this.maxRetryInterval) {
            this.urlIndex = (this.urlIndex + 1) % this.urls.length
            this.url = this.urls[this.urlIndex]
        }
        this.notifyState(3)
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            if (this.shouldConnect) this.reconnect()
        }, this.retryInterval)
        this.retryInterval = Math.min(this.retryInterval + 1000, this.maxRetryInterval)
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
