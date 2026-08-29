!macro customInit
  IfFileExists "$LOCALAPPDATA\MongoG\Update.exe" 0 mongog_squirrel_migration_done
  DetailPrint "Removing the previous MongoG Squirrel installation..."
  ExecWait '"$LOCALAPPDATA\MongoG\Update.exe" --uninstall -s'
  mongog_squirrel_migration_done:
!macroend
