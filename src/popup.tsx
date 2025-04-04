import Container from '~components/layouts/Container'
import {
  ClerkProvider,
} from '@clerk/chrome-extension'
import '~style.css'

const PUBLISHABLE_KEY = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY
const EXTENSION_URL = chrome.runtime.getURL('.')

if (!PUBLISHABLE_KEY) {
  throw new Error('Please add the PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY to the .env.development file')
}

function IndexPopup() {
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl={`${EXTENSION_URL}/popup.html`}
      signInFallbackRedirectUrl={`${EXTENSION_URL}/popup.html`}
      signUpFallbackRedirectUrl={`${EXTENSION_URL}/popup.html`}
    >
      <div className="plasmo-flex plasmo-items-center plasmo-justify-center plasmo-h-[600px] plasmo-w-[800px] plasmo-flex-col">
        <main className="plasmo-grow">
          <Container></Container>
        </main>
      </div>
    </ClerkProvider>
  )
}

export default IndexPopup
