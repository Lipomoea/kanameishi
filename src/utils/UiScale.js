export const MIN_UI_SCALE = 0.5
export const MAX_UI_SCALE = 2

export const isValidUiScale = value => Number.isFinite(value)
    && (value === -1 || (value >= MIN_UI_SCALE && value <= MAX_UI_SCALE))
