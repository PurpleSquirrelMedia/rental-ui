import { BN } from '@coral-xyz/anchor'
import { useWallet } from '@solana/wallet-adapter-react'
import type { Connection, Keypair } from '@solana/web3.js'
import { PublicKey, Transaction } from '@solana/web3.js'
import type { AccountData } from '@solana-nft-programs/common'
import {
  executeTransaction,
  withFindOrInitAssociatedTokenAccount,
  withWrapSol,
} from '@solana-nft-programs/common'
import { findNamespaceId, tryGetName } from '@solana-nft-programs/namespaces'
import { withClaimToken } from '@solana-nft-programs/token-manager'
import type { TokenManagerData } from '@solana-nft-programs/token-manager/dist/cjs/programs/tokenManager'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notify } from 'common/Notification'
import { getPriceFromTokenData } from 'common/tokenDataUtils'
import { asWallet } from 'common/Wallets'
import type { ProjectConfig } from 'config/config'
import type { TokenData } from 'data/data'
import { TOKEN_DATA_KEY } from 'hooks/useBrowseAvailableTokenDatas'
import {
  PAYMENT_MINTS,
  usePaymentMints,
  WRAPPED_SOL_MINT,
} from 'hooks/usePaymentMints'
import { useUserPaymentTokenAccount } from 'hooks/useUserPaymentTokenAccount'
import { logConfigTokenDataEvent } from 'monitoring/amplitude'
import { tracer, withTrace } from 'monitoring/trace'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'
import { useProjectConfig } from 'providers/ProjectConfigProvider'
import type { InvalidatorOption } from 'rental-components/components/RentalIssueCard'

export interface HandleClaimRentalParams {
  tokenData: TokenData
  otpKeypair?: Keypair
  rentalType: InvalidatorOption
}

export const allowedToRent = async (
  connection: Connection,
  walletId: PublicKey,
  config: ProjectConfig,
  tokenData: { tokenManager?: AccountData<Pick<TokenManagerData, 'issuer'>> },
  claimingRental: boolean,
  tokenDatasByIssuer: TokenData[]
): Promise<boolean> => {
  if (config.allowOneByCreators) {
    for (const creator of config.allowOneByCreators) {
      if (
        tokenData.tokenManager?.parsed.issuer.toString() === creator.address
      ) {
        if (creator.preventMultipleClaims && claimingRental) {
          notify({
            message: 'Error renting this NFT',
            description:
              'This issuer has prevented simultaneous rentals, please wait until the current rental claim is approved',
            type: 'error',
          })
          return false
        }
        if (creator.enforceTwitter) {
          const [namespaceId] = await findNamespaceId('twitter')
          const entryName = await tryGetName(connection, walletId, namespaceId)
          if (!entryName) {
            notify({
              message: 'Error renting this NFT',
              description:
                'You need to connect your twitter account to rent an NFT from this issuer. Click your profile on the top right corner to connect.',
              type: 'error',
            })
            return false
          }
        }
        if (
          tokenDatasByIssuer.some(
            (tk) =>
              tokenData.tokenManager?.parsed.issuer.toString() ===
                creator.address &&
              tk.recipientTokenAccount?.parsed.owner.toString() ===
                walletId?.toString() &&
              tk.tokenManager?.parsed.issuer.toString() === creator.address
          )
        ) {
          notify({
            message: 'Error renting this NFT',
            description:
              'The issuer of this NFT has limited only one NFT rental per user',
            type: 'error',
          })
          return false
        }
      }
    }
  }
  return true
}

export const useHandleClaimRental = () => {
  const wallet = useWallet()
  const { connection, secondaryConnection } = useEnvironmentCtx()
  const queryClient = useQueryClient()
  const userWSolTokenAccount = useUserPaymentTokenAccount(
    new PublicKey(WRAPPED_SOL_MINT)
  )
  const { config } = useProjectConfig()
  const paymentMints = usePaymentMints()

  return useMutation(
    async ({
      tokenData,
      otpKeypair,
      rentalType,
    }: HandleClaimRentalParams): Promise<string> => {
      if (!tokenData.tokenManager) throw new Error('No token manager data')
      if (!wallet.publicKey) throw new Error('Wallet not connected')
      const trace = tracer({ name: 'useHandleClaimRental' })

      const transaction = new Transaction()
      const wrapSolTx = new Transaction()
      const paymentMint =
        tokenData?.claimApprover?.parsed?.paymentMint ||
        tokenData?.timeInvalidator?.parsed?.extensionPaymentMint

      // wrap sol if there is payment required
      if (
        tokenData?.claimApprover?.parsed?.paymentAmount &&
        tokenData?.claimApprover?.parsed?.paymentMint.toString() ===
          WRAPPED_SOL_MINT.toString() &&
        tokenData?.claimApprover?.parsed?.paymentAmount.gt(new BN(0))
      ) {
        const amountToWrap =
          tokenData?.claimApprover?.parsed?.paymentAmount.sub(
            userWSolTokenAccount.data?.amount
              ? new BN(userWSolTokenAccount.data?.amount.toString())
              : new BN(0)
          )
        if (amountToWrap.gt(new BN(0))) {
          if (tokenData.metaplexData?.parsed.programmableConfig) {
            await withWrapSol(
              wrapSolTx,
              connection,
              asWallet(wallet),
              amountToWrap.toNumber()
            )
          } else {
            await withWrapSol(
              transaction,
              connection,
              asWallet(wallet),
              amountToWrap.toNumber()
            )
          }
        }
      }
      if (
        paymentMint &&
        (paymentMint?.toString() !== WRAPPED_SOL_MINT.toString() ||
          (transaction.instructions.length === 0 &&
            paymentMint?.toString() === WRAPPED_SOL_MINT.toString()))
      ) {
        await withFindOrInitAssociatedTokenAccount(
          transaction,
          connection,
          paymentMint,
          wallet.publicKey!,
          wallet.publicKey!,
          true
        )
      }

      await withClaimToken(
        transaction,
        tokenData?.tokenManager.parsed.receiptMint
          ? secondaryConnection
          : connection,
        asWallet(wallet),
        tokenData.tokenManager?.pubkey
      )

      if (wrapSolTx.instructions.length > 0) {
        await withTrace(
          () =>
            executeTransaction(connection, wrapSolTx, asWallet(wallet), {
              confirmOptions: {
                commitment: 'confirmed',
                maxRetries: 3,
              },
              signers:
                otpKeypair &&
                tokenData?.tokenManager?.parsed.claimApprover?.equals(
                  otpKeypair.publicKey
                )
                  ? [otpKeypair]
                  : [],
            }),
          trace,
          { op: 'executeTransaction' }
        )
      }
      const tx = await withTrace(
        () =>
          executeTransaction(connection, transaction, asWallet(wallet), {
            confirmOptions: {
              commitment: 'confirmed',
              maxRetries: 3,
            },
            signers:
              otpKeypair &&
              tokenData?.tokenManager?.parsed.claimApprover?.equals(
                otpKeypair.publicKey
              )
                ? [otpKeypair]
                : [],
          }),
        trace,
        { op: 'executeTransaction' }
      )

      logConfigTokenDataEvent('nft rental: claim', config, tokenData, {
        rental_type: rentalType,
        rental_price: getPriceFromTokenData(tokenData, paymentMints.data),
        rental_total_price: getPriceFromTokenData(tokenData, paymentMints.data),
        issuer_id: tokenData.tokenManager?.parsed.issuer.toString(),
        recipient_id: wallet.publicKey?.toString(),
        duration_seconds:
          tokenData.timeInvalidator?.parsed.durationSeconds?.toNumber(),
        expiration_timestamp:
          tokenData.timeInvalidator?.parsed.expiration?.toNumber(),
        max_expiration:
          tokenData.timeInvalidator?.parsed.maxExpiration?.toNumber(),
        payment_mint: PAYMENT_MINTS.filter(
          (mint) =>
            mint.mint ===
            tokenData.claimApprover?.parsed?.paymentMint.toString()
        )[0]?.symbol,
        extension_payment_mint: PAYMENT_MINTS.filter(
          (mint) =>
            mint.mint ===
            tokenData.timeInvalidator?.parsed?.extensionPaymentMint?.toString()
        )[0]?.symbol,
      })
      trace.finish()
      return tx
    },
    {
      onSuccess: () => {
        queryClient.resetQueries([TOKEN_DATA_KEY])
      },
      onError: async (e) => {
        if (e instanceof Error) {
          if (e.message.toString().includes('Invalid token manager state')) {
            alert(e)
            return 'Token manager has already been claimed'
          }
        }
        return e
      },
    }
  )
}
