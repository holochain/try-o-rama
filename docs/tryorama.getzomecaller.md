<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@holochain/tryorama](./tryorama.md) &gt; [getZomeCaller](./tryorama.getzomecaller.md)

## getZomeCaller variable

Get a shorthand function to call a cell's zome.

<b>Signature:</b>

```typescript
getZomeCaller: (cell: CallableCell, zomeName: string) => <T>(fnName: string, payload?: unknown, timeout?: number) => Promise<T>
```