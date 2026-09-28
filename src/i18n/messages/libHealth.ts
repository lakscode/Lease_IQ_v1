import { defineMessages } from '..'

// Setup check messages (src/lib/health.ts).
export const libHealth = defineMessages({
  en: {
    logsTable: 'Processing logs are not being saved: the lease_file_logs table is missing. Run {file} in the Supabase SQL Editor.',
    functionMissing: 'The analyze-lease Edge Function is not deployed.',
    functionOutdated:
      'The deployed analyze-lease Edge Function is out of date (deployed: {deployed}, expected: {expected}). Redeploy {file}.',
    olderThanV3: 'older than v3',
    functionUnreachable: 'Could not reach the analyze-lease Edge Function. Make sure it is deployed.',
  },
  de: {
    logsTable:
      'Verarbeitungsprotokolle werden nicht gespeichert: Die Tabelle lease_file_logs fehlt. Führen Sie {file} im SQL-Editor von Supabase aus.',
    functionMissing: 'Die Edge Function analyze-lease ist nicht bereitgestellt.',
    functionOutdated:
      'Die bereitgestellte Edge Function analyze-lease ist veraltet (bereitgestellt: {deployed}, erwartet: {expected}). Stellen Sie {file} erneut bereit.',
    olderThanV3: 'älter als v3',
    functionUnreachable: 'Die Edge Function analyze-lease ist nicht erreichbar. Stellen Sie sicher, dass sie bereitgestellt ist.',
  },
  es: {
    logsTable:
      'Los registros de procesamiento no se están guardando: falta la tabla lease_file_logs. Ejecute {file} en el SQL Editor de Supabase.',
    functionMissing: 'La Edge Function analyze-lease no está desplegada.',
    functionOutdated:
      'La Edge Function analyze-lease desplegada está desactualizada (desplegada: {deployed}, esperada: {expected}). Vuelva a desplegar {file}.',
    olderThanV3: 'anterior a v3',
    functionUnreachable: 'No se pudo contactar con la Edge Function analyze-lease. Asegúrese de que esté desplegada.',
  },
  pt: {
    logsTable:
      'Os logs de processamento não estão sendo salvos: a tabela lease_file_logs não existe. Execute {file} no SQL Editor do Supabase.',
    functionMissing: 'A Edge Function analyze-lease não está implantada.',
    functionOutdated:
      'A Edge Function analyze-lease implantada está desatualizada (implantada: {deployed}, esperada: {expected}). Implante novamente {file}.',
    olderThanV3: 'anterior à v3',
    functionUnreachable: 'Não foi possível acessar a Edge Function analyze-lease. Verifique se ela está implantada.',
  },
  it: {
    logsTable:
      'I log di elaborazione non vengono salvati: manca la tabella lease_file_logs. Esegui {file} nell’SQL Editor di Supabase.',
    functionMissing: 'La Edge Function analyze-lease non è distribuita.',
    functionOutdated:
      'La Edge Function analyze-lease distribuita non è aggiornata (distribuita: {deployed}, prevista: {expected}). Ridistribuisci {file}.',
    olderThanV3: 'precedente alla v3',
    functionUnreachable: 'Impossibile raggiungere la Edge Function analyze-lease. Verifica che sia distribuita.',
  },
})
