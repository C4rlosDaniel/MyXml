<#
  Fase 1 — Ativação do Supabase
  Uso:
    .\scripts\setup-supabase.ps1 -ProjectRef "SEU_REF" -AdminEmail "admin@empresa.com.br"
  Se o usuário admin ainda não existe no Auth, crie-o primeiro no dashboard
  do Supabase (Authentication → Add user) e depois rode com -ApplyAdmin.
#>
param(
  [string]$ProjectRef,
  [string]$AdminEmail,
  [switch]$ApplyAdmin
)

$ErrorActionPreference = 'Stop'

if (-not $ProjectRef) { $ProjectRef = Read-Host 'Project ref do Supabase' }
if (-not $AdminEmail) { $AdminEmail = Read-Host 'E-mail do primeiro admin' }

Write-Host "`n[1/4] Login no Supabase..." -ForegroundColor Cyan
supabase login

Write-Host "`n[2/4] Vinculando projeto $ProjectRef ..." -ForegroundColor Cyan
supabase link --project-ref $ProjectRef

Write-Host "`n[3/4] Aplicando migrations..." -ForegroundColor Cyan
supabase db push

$sql = @"
update public.profiles set role = 'admin'
  where id = (select id from auth.users where email = '$AdminEmail');
update public.licenses set status = 'ativo', valid_until = null
  where user_id = (select id from auth.users where email = '$AdminEmail');
"@

Write-Host "`n[4/4] SQL para promover o admin:" -ForegroundColor Cyan
Write-Host $sql

if ($ApplyAdmin) {
  Write-Host 'Aplicando SQL no banco remoto...' -ForegroundColor Yellow
  supabase db execute --sql $sql
  Write-Host 'Admin promovido.' -ForegroundColor Green
} else {
  Write-Host 'Rode o SQL acima no SQL Editor do Supabase (ou use -ApplyAdmin).' -ForegroundColor Yellow
}

Write-Host "`nDepois: preencha web/.env.local e api/.env e reinicie o front e a API." -ForegroundColor Green
