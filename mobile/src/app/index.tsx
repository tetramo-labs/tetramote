import {remote} from "@tetramote/remote"
import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import {MonitorSmartphone, Plus, Settings} from "lucide-react-native"
import {useEffect, useRef} from "react"
import {Alert, FlatList, View} from "react-native"

import {HostCard} from "@/components/hosts/HostCard"
import {PairSheet} from "@/components/hosts/PairSheet"
import {Button} from "@/components/ignite/Button"
import {Header} from "@/components/ignite/Header"
import {Icon} from "@/components/ignite/Icon"
import {Screen} from "@/components/ignite/Screen"
import {Text} from "@/components/ignite/Text"
import {useAppTheme} from "@/contexts/ThemeContext"
import {usePageGutters} from "@/hooks/useLayout"
import {translate} from "@/i18n"
import {parsePairingUrl} from "@/services/pairingUrl"
import {connectTo} from "@/services/remote"
import {useHostsStore, type PairedMac} from "@/stores/hosts"
import {useNavigationStore} from "@/stores/navigation"

export default function HomeScreen() {
  const {theme} = useAppTheme()
  const hosts = useHostsStore((s) => s.hosts)
  const forget = useHostsStore((s) => s.forget)
  const push = useNavigationStore((s) => s.push)
  const gutters = usePageGutters()
  const pairSheet = useRef<BottomSheetModal>(null)

  useEffect(() => {
    const code = parsePairingUrl(remote.launchPairingUrl() ?? "")
    if (code) push({pathname: "/pair", params: {...code}})
  }, [push])

  const open = (host: PairedMac) => {
    connectTo(host)
    push("/session")
  }

  const confirmForget = (host: PairedMac) => {
    Alert.alert(translate("home:forgetTitle", {name: host.name}), translate("home:forgetMessage"), [
      {text: translate("common:cancel"), style: "cancel"},
      {text: translate("common:remove"), style: "destructive", onPress: () => forget(host.id)},
    ])
  }

  return (
    <Screen
      header={
        <Header
          titleTx="home:title"
          rightIcon={Settings}
          rightLabel={translate("settings:title")}
          onRightPress={() => push("/settings")}
        />
      }>
      {hosts.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-4 px-4">
          <View className="w-20 h-20 rounded-full items-center justify-center bg-primary-foreground">
            <Icon icon={MonitorSmartphone} size={36} color={theme.colors.brand_primary} />
          </View>
          <Text tx="home:empty" preset="subheading" className="text-foreground text-center" />
          <Text tx="home:emptyHint" size="sm" className="text-muted-foreground text-center" />
        </View>
      ) : (
        <FlatList
          data={hosts}
          keyExtractor={(h) => h.id}
          automaticallyAdjustsScrollIndicatorInsets={false}
          style={{marginLeft: -gutters.left, marginRight: -gutters.right}}
          contentContainerClassName="gap-3 pt-2 pb-6"
          contentContainerStyle={{paddingLeft: gutters.left, paddingRight: gutters.right}}
          renderItem={({item}) => (
            <HostCard host={item} onPress={() => open(item)} onLongPress={() => confirmForget(item)} />
          )}
        />
      )}
      <Button
        tx="home:pair"
        onPress={() => pairSheet.current?.present()}
        LeftAccessory={() => <Icon icon={Plus} size={18} color={theme.colors.primary_foreground} />}
        style={{marginBottom: 8}}
      />
      <PairSheet sheet={pairSheet} />
    </Screen>
  )
}
