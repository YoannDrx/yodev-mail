import { GetParametersCommand } from "@aws-sdk/client-ssm";
import { awsClients } from "@/lib/aws";

const parameterSuffixes = {
  DATABASE_URL: "database-url",
  STRIPE_SECRET_KEY: "stripe-secret-key",
  WEBHOOK_SIGNING_SECRET: "webhook-signing-secret",
} as const;

export type RuntimeSecretName = keyof typeof parameterSuffixes;
type RuntimeParameter = { Name?: string; Value?: string };

export function mapRuntimeParameters(
  prefix: string,
  parameters: RuntimeParameter[],
  required: RuntimeSecretName[] = Object.keys(parameterSuffixes) as RuntimeSecretName[],
): Partial<Record<RuntimeSecretName, string>> {
  const byName = new Map(
    parameters.flatMap((parameter) =>
      parameter.Name && parameter.Value
        ? [[parameter.Name, parameter.Value] as const]
        : [],
    ),
  );
  return Object.fromEntries(
    required.map((environmentName) => {
      const suffix = parameterSuffixes[environmentName];
      const name = `${prefix}/${suffix}`;
      const value = byName.get(name);
      if (!value) throw new Error(`Required runtime parameter is missing: ${name}`);
      return [environmentName, value];
    }),
  ) as Partial<Record<RuntimeSecretName, string>>;
}

const loadingByName = new Map<RuntimeSecretName, Promise<void>>();

export async function loadRuntimeSecrets(
  required: RuntimeSecretName[] = ["DATABASE_URL"],
) {
  const prefix = process.env.RUNTIME_PARAMETER_PREFIX;
  if (!prefix) return;
  const missing = required.filter((name) => !process.env[name]);
  if (!missing.length) return;

  const pending = missing.map((name) => {
    const current = loadingByName.get(name);
    if (current) return current;
    const loading = (async () => {
      const parameterName = `${prefix}/${parameterSuffixes[name]}`;
      const { ssm: client } = await awsClients();
      const response = await client.send(
        new GetParametersCommand({ Names: [parameterName], WithDecryption: true }),
      );
      if (response.InvalidParameters?.length) {
        throw new Error("One or more required runtime parameters are invalid.");
      }
      Object.assign(
        process.env,
        mapRuntimeParameters(prefix, response.Parameters ?? [], [name]),
      );
    })().catch((error) => {
      loadingByName.delete(name);
      throw error;
    });
    loadingByName.set(name, loading);
    return loading;
  });
  await Promise.all(pending);
}

const secureParameterCache = new Map<string, string>();

export async function getSecureParameter(name: string) {
  const cached = secureParameterCache.get(name);
  if (cached) return cached;
  const { ssm: client } = await awsClients();
  const response = await client.send(
    new GetParametersCommand({ Names: [name], WithDecryption: true }),
  );
  const value = response.Parameters?.[0]?.Value;
  if (!value) throw new Error("Required provider credential is unavailable.");
  secureParameterCache.set(name, value);
  return value;
}
