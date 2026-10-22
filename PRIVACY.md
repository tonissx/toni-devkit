# Política de Privacidade / Privacy Policy

**Devkit** — [github.com/tonissx/toni-devkit](https://github.com/tonissx/toni-devkit)
Última atualização / Last updated: 2026-10-21

[Português](#português) · [English](#english)

---

## Português

O Devkit é um aplicativo de desktop. **Não existe servidor do Devkit**: o aplicativo não envia seus dados para o autor nem para terceiros contratados por ele, e não inclui telemetria nem análise de uso.

### Dados guardados no seu computador
- Suas notas, anexos, Lixeira e configurações ficam em arquivos no seu computador (por padrão em `Documentos\Devkit Notes` e na pasta de dados do aplicativo).
- O Cofre (Vault) é cifrado com a sua senha mestra e guardado só no seu computador.

### Sincronização com o Google Drive (opcional)
Se você conectar sua conta Google, o Devkit usa a API do Google Drive **somente** com a permissão `https://www.googleapis.com/auth/drive.appdata`:
- **O que é acessado:** apenas a pasta privada do próprio aplicativo no seu Drive (`appDataFolder`). O Devkit **não consegue ver, ler ou alterar nenhum outro arquivo** do seu Drive. Essa pasta não aparece no site do Google Drive.
- **O que é enviado e baixado:** suas notas (`.md`, inclusive as da Lixeira), as configurações de pasta e os anexos, entre o seu computador e o seu Google Drive. Nada é enviado a outro destino.
- **Credenciais:** o login é feito no navegador, pelo Google. O Devkit **nunca vê a sua senha do Google**. O token de acesso renovável fica **cifrado pelo sistema operacional** (Electron `safeStorage`), na pasta de dados do aplicativo no seu computador, e nunca dentro da pasta das notas.
- **Uso e compartilhamento:** os dados recebidos do Google são usados apenas para sincronizar as suas notas entre os seus computadores. Não são vendidos, compartilhados com terceiros, usados para publicidade nem lidos por pessoas.
- **Desconectar e apagar:** em *Configurações de Notes → Google Drive → Desconectar* o aplicativo apaga o token do seu computador. Para revogar o acesso também no Google, use [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Para apagar os dados guardados no Drive, remova os dados ocultos do Devkit em *Google Drive → Configurações → Gerenciar aplicativos*.

O uso e a transferência, para qualquer outro aplicativo, de informações recebidas das APIs do Google seguem a [Política de Dados do Usuário dos Serviços de API do Google](https://developers.google.com/terms/api-services-user-data-policy), incluindo os requisitos de Uso Limitado.

### Outras conexões de rede
- **Atualizações:** o aplicativo pode consultar o GitHub para saber se há uma versão nova. Essa consulta não envia o conteúdo das suas notas.
- **IA (opcional):** os recursos de IA usam um modelo local (Ollama) por padrão. Se você escolher o modo em nuvem, o conteúdo da tarefa só é enviado ao provedor que você configurou **depois da sua confirmação**, e você pode ver o que será enviado antes.

### Contato
Dúvidas ou pedidos: abra uma *issue* em [github.com/tonissx/toni-devkit/issues](https://github.com/tonissx/toni-devkit/issues).

Mudanças nesta política serão publicadas neste arquivo, com a data atualizada.

---

## English

Devkit is a desktop application. **There is no Devkit server**: the app does not send your data to its author or to any third party engaged by the author, and it includes no telemetry or usage analytics.

### Data stored on your computer
- Your notes, attachments, Trash and settings are files on your computer (by default in `Documents\Devkit Notes` and in the application's data folder).
- The Vault is encrypted with your master password and stored only on your computer.

### Google Drive sync (optional)
If you connect your Google account, Devkit uses the Google Drive API **only** with the scope `https://www.googleapis.com/auth/drive.appdata`:
- **What is accessed:** only the application's own private folder in your Drive (`appDataFolder`). Devkit **cannot see, read or modify any other file** in your Drive. That folder is not visible on the Google Drive website.
- **What is sent and downloaded:** your notes (`.md`, including Trash), folder settings and attachments, between your computer and your own Google Drive. Nothing is sent anywhere else.
- **Credentials:** sign-in happens in your browser, handled by Google. Devkit **never sees your Google password**. The renewable access token is stored **encrypted by your operating system** (Electron `safeStorage`) in the application's data folder on your computer, never inside the notes folder.
- **Use and sharing:** data received from Google is used only to sync your notes between your own computers. It is not sold, shared with third parties, used for advertising, or read by humans.
- **Disconnect and delete:** *Notes settings → Google Drive → Disconnect* deletes the token from your computer. To also revoke access on Google's side, use [myaccount.google.com/permissions](https://myaccount.google.com/permissions). To delete the data stored in Drive, remove Devkit's hidden app data under *Google Drive → Settings → Manage apps*.

Devkit's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

### Other network connections
- **Updates:** the app may check GitHub to see whether a newer version exists. This request does not include the contents of your notes.
- **AI (optional):** AI features use a local model (Ollama) by default. If you choose cloud mode, the task content is sent to the provider you configured only **after you confirm**, and you can review what will be sent first.

### Contact
Questions or requests: open an issue at [github.com/tonissx/toni-devkit/issues](https://github.com/tonissx/toni-devkit/issues).

Changes to this policy will be published in this file with an updated date.
