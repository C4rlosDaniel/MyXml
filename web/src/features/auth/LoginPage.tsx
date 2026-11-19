import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Logo } from '@/components/Logo'
import { Button, Card, Input, useToast } from '@/design-system'
import { useAuth } from './AuthProvider'

const schema = z.object({
  email: z.string().min(1, 'Informe seu e-mail.').email('E-mail inválido.'),
  password: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres.'),
})

type FormData = z.infer<typeof schema>

export function LoginPage() {
  const { signIn } = useAuth()
  const { success, error: showError } = useToast()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (data: FormData) => {
    try {
      await signIn(data.email, data.password)
      success('Bem-vindo de volta!', 'Acesso liberado ao painel MyXml.')
      navigate('/', { replace: true })
    } catch (err) {
      showError('Não foi possível entrar', err instanceof Error ? err.message : 'Tente novamente.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card variant="raised" className="w-full max-w-md p-7 sm:p-9">
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo className="mb-6 h-20" />
          <h1 className="text-2xl font-extrabold tracking-tight text-txt-primary">
            Bem-vindo de volta
          </h1>
          <p className="mt-2 text-sm text-txt-secondary">
            Entre para acessar suas notas fiscais.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <Input
            label="E-mail"
            type="email"
            autoComplete="email"
            icon={<Mail className="h-4 w-4" />}
            error={errors.email?.message}
            {...register('email')}
          />

          <div className="relative">
            <Input
              label="Senha"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              icon={<Lock className="h-4 w-4" />}
              error={errors.password?.message}
              className="pr-12"
              {...register('password')}
            />
            {!errors.password && (
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm p-1.5 text-txt-muted transition-colors hover:text-accent-fg focus-ring"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            )}
          </div>

          <Button type="submit" size="lg" fullWidth loading={isSubmitting} loadingText="Entrando...">
            Entrar <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        <div className="mt-6 flex items-center gap-2 rounded-sm border border-line bg-subtle p-3 text-xs text-txt-muted">
          <ShieldCheck className="h-4 w-4 shrink-0 text-success-fg" />
          <span>Seu acesso é liberado pelo administrador do sistema.</span>
        </div>

      </Card>
    </div>
  )
}
