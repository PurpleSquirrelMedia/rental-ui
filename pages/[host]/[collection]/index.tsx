import { css } from '@emotion/react'
import { firstParam } from '@solana-nft-programs/common'
import { Banner } from 'common/Banner'
import { FooterSlim } from 'common/FooterSlim'
import { Browse } from 'components/Browse'
import DisallowedRegion from 'components/DisallowedRegion'
import Error from 'components/Error'
import { Manage } from 'components/Manage'
import { useUserRegion } from 'hooks/useUserRegion'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useProjectConfig } from 'providers/ProjectConfigProvider'
import { useEffect, useState } from 'react'

export default function Home() {
  const { config, setProjectConfig } = useProjectConfig()
  const [tab, setTab] = useState<string>()
  const userRegion = useUserRegion()
  const router = useRouter()

  useEffect(() => {
    const anchor = router.asPath.split('#')[1]
    if (anchor !== tab) setTab(anchor || '')
  }, [router, tab])

  useEffect(() => {
    const collection = firstParam(router.query.collection)
    if (router.query.collection !== config.name && collection) {
      setProjectConfig(collection)
    }
  }, [router.query.collection])

  if (router.query.collection !== config.name) {
    return <Error />
  }

  if (!userRegion.isFetched) {
    return <></>
  }

  if (!userRegion.data?.isAllowed && !process.env.BYPASS_REGION_CHECK) {
    return <DisallowedRegion />
  }

  return (
    <div className="relative z-0 flex min-h-screen flex-col bg-dark-5">
      <div
        className="blur-4xl absolute left-8 top-52 -z-10 h-[120px] w-[400px] -rotate-[60deg] bg-glow blur-[100px]"
        css={css`
          background: ${config.colors.glow} !important;
        `}
      />
      <div
        className="blur-4xl absolute -right-20 top-72 -z-10 h-[100px] w-[550px] -rotate-[60deg] bg-glow blur-[120px]"
        css={css`
          background: ${config.colors.glow} !important;
        `}
      />
      <Head>
        <title> | {config.displayName}</title>
        <link rel="icon" href="/favicon.ico" />

        <link
          href="https://fonts.googleapis.com/css2?family=Roboto&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Lato:wght@100&display=swap"
          rel="stylesheet"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Kanit:ital@0;1&family=Oswald:wght@200;300;400;500&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Karla:wght@600&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Banner />
      <div style={{ minHeight: 'calc(100vh - 337px)' }} className="grow">
        {(() => {
          switch (tab) {
            case 'manage':
              return <Manage />
            default:
              return <Browse />
          }
        })()}
      </div>
      <FooterSlim />
    </div>
  )
}
