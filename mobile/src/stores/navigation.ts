import {router, type Href} from "expo-router"
import {create} from "zustand"

/**
 * The only place that mutates expo-router's stack; screens and components
 * navigate through this store.
 */
interface NavigationState {
  push: (path: Href) => void
  replace: (path: Href) => void
  goBack: () => void
  goHome: () => void
}

export const useNavigationStore = create<NavigationState>()(() => ({
  push: (path) => router.push(path),
  replace: (path) => router.replace(path),
  goBack: () => {
    if (router.canGoBack()) router.back()
    else router.replace("/")
  },
  goHome: () => {
    if (router.canDismiss()) router.dismissAll()
    router.replace("/")
  },
}))
