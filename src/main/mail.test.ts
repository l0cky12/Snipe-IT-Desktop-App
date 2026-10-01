import { expect, it } from 'vitest'
import { mailError } from './mail'

const server = { host: 'smtp.gmail.com', port: 465 }
const fail = (code: string, response = '', message = response) => Object.assign(new Error(message), { code, response })

it("puts the mail server's errors in plain language", () => {
  expect(mailError(fail('EAUTH', '535-5.7.8 Username and Password not accepted.'), server)).toMatch(/rejected the username or password.*app password/)
  expect(mailError(fail('EAUTH', '534-5.7.9 Application-specific password required.'), server)).toMatch(/needs an app password.*2-Step Verification.*turned off/)
  expect(mailError(fail('EDNS', '', 'getaddrinfo ENOTFOUND smtp.gmail.con'), server)).toMatch(/Can't find the mail server smtp\.gmail\.com/)
  for (const code of ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ETLS', 'ECONNREFUSED'])
    expect(mailError(fail(code), server)).toMatch(/Can't connect to smtp\.gmail\.com:465.*465 uses SSL\/TLS/)
  expect(mailError(fail('EENVELOPE', '553 sender not allowed'), server)).toMatch(/refused the sender or recipient.*553 sender not allowed/)
  expect(mailError(fail('EMESSAGE', '', 'odd thing'), server)).toBe('The mail server refused to send: odd thing')
})
