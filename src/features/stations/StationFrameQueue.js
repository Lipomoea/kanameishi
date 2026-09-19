// Each source owns a queue. Known target times group multiple attempts for one frame.
export class StationFrameQueue {
    constructor(commit, isOrdered = () => false) {
        this.commit = commit
        this.isOrdered = isOrdered
        this.generation = 0
        this.entries = []
        this.groups = new Map()
        this.lastStamp = null
    }
    begin(target = null) {
        if(Number.isFinite(target) && this.lastStamp !== null && target <= this.lastStamp) {
            return { generation: this.generation, settled: true }
        }
        let entry = target === null ? null : this.groups.get(target)
        if(!entry) {
            entry = { target, pending: 0, frame: null, closed: false }
            this.entries.push(entry)
            if(target !== null) this.groups.set(target, entry)
        }
        entry.pending++
        return { entry, generation: this.generation, settled: false }
    }
    isPending(ticket) {
        return ticket.generation === this.generation && !ticket.settled && !ticket.entry.closed
    }
    finish(ticket, frame = null) {
        if(!this.isPending(ticket)) return
        ticket.settled = true
        const entry = ticket.entry
        entry.pending--
        if(frame && Number.isFinite(frame.timestamp) &&
            (this.lastStamp === null || frame.timestamp > this.lastStamp)) {
            entry.frame ??= frame
        }
        this.flush()
    }
    remove(entry) {
        entry.closed = true
        this.entries.splice(this.entries.indexOf(entry), 1)
        if(entry.target !== null) this.groups.delete(entry.target)
    }
    flush() {
        while(this.entries.length) {
            const entry = this.isOrdered() ? this.entries[0]
                : this.entries.find(item => item.frame || item.pending === 0)
            if(!entry) return
            if(!entry.frame && entry.pending > 0) {
                // Duplicate timestamps do not consume the one-frame waiting allowance.
                const readyStamps = new Set(this.entries
                    .filter(item => item.frame && (this.lastStamp === null || item.frame.timestamp > this.lastStamp))
                    .map(item => item.frame.timestamp))
                if(readyStamps.size < 2) return
                this.remove(entry)
                continue
            }
            this.remove(entry)
            const frame = entry.frame
            if(frame && (this.lastStamp === null || frame.timestamp > this.lastStamp)) {
                this.lastStamp = frame.timestamp
                this.commit(frame)
            }
        }
    }
    reset(lastStamp = null) {
        this.generation++
        this.entries.length = 0
        this.groups.clear()
        this.lastStamp = lastStamp
    }
}
