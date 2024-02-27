import { getEnv } from 'waku/server';

export const ContactPage = () => {
  const pwd = getEnv('DONT_LEAK_IN_BUILD_TIME')
  if (pwd === "NO") {
    throw new Error('SHOULD NOT LEAK')
  }
  return (
    <div>
      This is contact page, password {pwd}
    </div>
  )
}
