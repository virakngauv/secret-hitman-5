export const ROOM_CODE_CONSONANTS = 'bcdfghkpqrstvz'
export const ROOM_CODE_FINAL_CHARACTERS = '23456789y'

export const ROOM_CODE_PATTERN = new RegExp(
  `^[${ROOM_CODE_CONSONANTS}]{4}[${ROOM_CODE_FINAL_CHARACTERS}]$`,
)
