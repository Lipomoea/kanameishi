const parseVersion = version => {
    if(typeof version !== 'string') return null
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/)
    if(!match) return null
    return { numbers: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? [] }
}

// Returns -1, 0 or 1; null means one of the versions cannot be compared.
export const compareVersions = (left, right) => {
    const a = parseVersion(left), b = parseVersion(right)
    if(!a || !b) return null
    for(let i = 0; i < 3; i++) {
        if(a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i] ? 1 : -1
    }
    if(!a.prerelease.length && !b.prerelease.length) return 0
    if(!a.prerelease.length) return 1
    if(!b.prerelease.length) return -1
    for(let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
        const x = a.prerelease[i], y = b.prerelease[i]
        if(x === undefined) return -1
        if(y === undefined) return 1
        if(x === y) continue
        const xNumeric = /^\d+$/.test(x), yNumeric = /^\d+$/.test(y)
        if(xNumeric && yNumeric) {
            if(Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1
        }
        else if(xNumeric !== yNumeric) return xNumeric ? -1 : 1
        else return x > y ? 1 : -1
    }
    return 0
}
