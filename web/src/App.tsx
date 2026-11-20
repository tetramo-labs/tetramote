import {useEffect, useState} from "react"

import {Landing} from "@/Landing"
import {parseFragment, type Link} from "@/link"
import {SessionView} from "@/SessionView"

function linkFromLocation(): Link | null {
  return parseFragment(window.location.hash)
}

/** The link's fragment picks the computer; without one, the page asks for a link. */
export function App() {
  const [link, setLink] = useState<Link | null>(linkFromLocation)

  useEffect(() => {
    const update = () => setLink(linkFromLocation())
    window.addEventListener("hashchange", update)
    return () => window.removeEventListener("hashchange", update)
  }, [])

  const leave = () => {
    history.replaceState(null, "", window.location.pathname)
    setLink(null)
  }

  return link ? <SessionView key={link.endpointId + link.secret} link={link} onLeave={leave} /> : <Landing />
}
