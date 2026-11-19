import "intl-pluralrules"
import i18n, {type TOptions} from "i18next"
import {initReactI18next} from "react-i18next"

import en, {type Translations} from "./en"

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>
}[keyof T & string]

type NamespacedKey<T> = {
  [N in keyof T & string]: `${N}:${Leaves<T[N]>}`
}[keyof T & string]

export type TxKeyPath = NamespacedKey<Translations>

i18n.use(initReactI18next).init({
  resources: {en},
  lng: "en",
  fallbackLng: "en",
  ns: Object.keys(en),
  defaultNS: "common",
  interpolation: {escapeValue: false},
  returnNull: false,
})

export function translate(key: TxKeyPath, options?: TOptions): string {
  return i18n.t(key, options ?? {})
}

export default i18n
