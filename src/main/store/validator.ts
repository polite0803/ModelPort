/**
 * Credential Storage Module - Credential Validation
 * Validate credentials for each provider
 */

import axios, { AxiosError } from 'axios'
import { Provider, ValidationResult } from './types'
import { ProviderChecker } from '../providers/checker'

/**
 * Validator interface
 */
interface Validator {
  validate(credentials: Record<string, string>): Promise<ValidationResult>
}

/**
 * Generic Token Validator
 * Used for simple validation of custom providers
 */
class GenericTokenValidator implements Validator {
  private apiEndpoint: string
  private headers: Record<string, string>

  constructor(apiEndpoint: string, headers: Record<string, string>) {
    this.apiEndpoint = apiEndpoint
    this.headers = headers
  }

  async validate(credentials: Record<string, string>): Promise<ValidationResult> {
    const token = credentials.apiKey || credentials.token || credentials.authorization

    if (!token) {
      return {
        valid: false,
        error: 'Missing authentication token',
        validatedAt: Date.now(),
      }
    }

    try {
      const headers: Record<string, string> = {
        ...this.headers,
        Authorization: `Bearer ${token}`,
      }

      const response = await axios.get(`${this.apiEndpoint}/models`, {
        headers,
        timeout: 10000,
      })

      if (response.status === 200) {
        return {
          valid: true,
          validatedAt: Date.now(),
        }
      }

      return {
        valid: false,
        error: `Validation failed: HTTP ${response.status}`,
        validatedAt: Date.now(),
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError

        if (axiosError.response?.status === 401) {
          return {
            valid: false,
            error: 'Invalid authentication token',
            validatedAt: Date.now(),
          }
        }

        return {
          valid: false,
          error: `Validation failed: ${axiosError.message}`,
          validatedAt: Date.now(),
        }
      }

      return {
        valid: false,
        error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        validatedAt: Date.now(),
      }
    }
  }
}

/**
 * Validate credential validity
 * @param provider Provider configuration
 * @param credentials Credential data
 * @returns Validation result
 */
export async function validateCredentials(
  provider: Provider,
  credentials: Record<string, string>
): Promise<ValidationResult> {
  // Built-in providers use ProviderChecker for validation
  if (provider.type === 'builtin') {
    const tempAccount = {
      id: 'temp',
      providerId: provider.id,
      name: 'temp',
      credentials,
      status: 'active' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const result = await ProviderChecker.checkAccountToken(provider, tempAccount)

    return {
      valid: result.valid,
      error: result.error,
      validatedAt: Date.now(),
      accountInfo: result.userInfo,
    }
  }

  // Custom providers use generic validator
  const validator = new GenericTokenValidator(provider.apiEndpoint, provider.headers)

  try {
    return await validator.validate(credentials)
  } catch (error) {
    return {
      valid: false,
      error: `Validation exception: ${error instanceof Error ? error.message : 'Unknown error'}`,
      validatedAt: Date.now(),
    }
  }
}
