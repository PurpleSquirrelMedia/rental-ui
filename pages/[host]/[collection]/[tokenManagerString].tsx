import * as metaplex from '@metaplex-foundation/mpl-token-metadata'
import { Connection } from '@solana/web3.js'
import { findMintMetadataId, tryPublicKey } from '@solana-nft-programs/common'
import { tokenManager } from '@solana-nft-programs/token-manager/dist/cjs/programs'
import { TokenManagerState } from '@solana-nft-programs/token-manager/dist/cjs/programs/tokenManager'
import Claim from 'components/Claim'
import { ENVIRONMENTS } from 'providers/EnvironmentProvider'

function ClaimHome(props: {
  isClaimed: boolean
  nftName: string
  nftImageUrl: string
}) {
  return <Claim {...props} />
}

export async function getServerSideProps(context: any) {
  const query = context.query
  const tokenManagerString = query.tokenManagerString
  const mintIdString = query.mintIdString

  const cluster = (query.project || query.host)?.includes('dev')
    ? 'devnet'
    : query.host?.includes('test')
    ? 'testnet'
    : query.cluster || process.env.BASE_CLUSTER || 'mainnet'
  const foundEnvironment = ENVIRONMENTS.find((e) => e.label === cluster)
  const environment = foundEnvironment ?? ENVIRONMENTS[0]!
  const connection = new Connection(environment.primary, {
    commitment: 'recent',
  })

  let nftImageUrl: string | null = null
  let nftName: string | null = null

  const tokenManagerId = tryPublicKey(tokenManagerString)
  if (!tokenManagerId) {
    return {}
  }
  const tokenManagerData = await tokenManager.accounts
    .getTokenManager(connection, tokenManagerId)
    .catch((e) => {
      console.log('Failed to get token manager data', e)
      return null
    })
  const mintId = tokenManagerData?.parsed.mint ?? tryPublicKey(mintIdString)
  const isClaimed = tokenManagerData?.parsed.state === TokenManagerState.Claimed

  if (!mintId) {
    return { props: {} }
  }
  const metaplexId = findMintMetadataId(mintId)
  const metaplexData = await metaplex.Metadata.fromAccountAddress(
    connection,
    metaplexId
  ).catch((e) => {
    console.log('Failed to get metaplex data', e)
    return null
  })
  if (metaplexData) {
    try {
      const json = (await fetch(metaplexData.data.uri).then((r) =>
        r.json()
      )) as { image?: string; name?: string } | null
      nftImageUrl = json?.image ?? null
      nftName = json?.name ?? null
    } catch (e) {
      console.log('Failed to get metadata data', e)
    }
  }

  return {
    props: {
      isClaimed,
      nftImageUrl,
      nftName,
    },
  }
}

export default ClaimHome
