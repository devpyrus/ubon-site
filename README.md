# Site do Ubon

O site do app Ubon: https://ubon.pro

É feito só de arquivos prontos (HTML, CSS e imagens), sem nada pra montar.
O Cloudflare Pages publica esta pasta do jeito que ela está: mudou um
arquivo aqui no GitHub, o site atualiza sozinho em um ou dois minutos.

## Páginas

- `index.html`: a página inicial.
- `planos/`: os planos do Ubon Pro e a compra (com o código da conta).
- `obrigado/`: aparece depois do pagamento e mostra quando o Pro foi liberado.
- `baixar/`: o download e o passo a passo pra instalar.
- `politica-de-privacidade/`, `termos-de-uso/` e `excluir-conta/`: os textos
  que a Google Play pede. São os mesmos textos que estão dentro do app.
- `404.html`: aparece quando alguém abre um endereço que não existe.

## O programa da compra (`functions/`)

O Cloudflare Pages roda sozinho o que está em `functions/api/`: é ele que
pede o link de pagamento à InfinitePay, confere cada pagamento direto com a
InfinitePay e libera o Pro no RevenueCat. Ele precisa de três variáveis,
que ficam **só no Cloudflare** (Settings → Variables and Secrets), nunca
aqui: `INFINITEPAY_HANDLE`, `INFINITEPAY_API_KEY` e `REVENUECAT_SECRET_KEY`.

## Outros arquivos

- `assets/`: o estilo, as letras, as imagens e o script da demonstração do card.
- `_redirects`: o atalho `/apk` (e os endereços antigos de comprar, que
  levam pros planos).
- `_headers`: cabeçalhos de segurança.
- `robots.txt` e `sitemap.xml`: ajudam o Google a achar as páginas.

## O arquivo do app

O `Ubon.apk` não fica nesta pasta: ele vai em **Releases**, porque o
Cloudflare Pages não aceita arquivo maior que 25 MB. O endereço
`ubon.pro/apk` sempre leva pro `Ubon.apk` do release mais novo.

As letras Roboto e Roboto Condensed são do Google, com as licenças que estão
em `assets/fontes/`.
