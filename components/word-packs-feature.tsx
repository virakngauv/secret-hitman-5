'use client'

import { createContext, useContext } from 'react'

export const WordPacksFeatureContext = createContext(false)
export const useWordPacksEnabled = () => useContext(WordPacksFeatureContext)
