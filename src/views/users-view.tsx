import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Users as UsersIcon, Loader2, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { GlassCard } from "@/components/common/glass-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";

export default function UsersView() {
  const { isRtl } = useTranslation();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [department, setDepartment] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.getUsers(),
  });

  const inviteMutation = useMutation({
    mutationFn: () => api.inviteUser({ name, email, role, department }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(isRtl ? `تم إرسال الدعوة إلى ${email}` : `Invitation sent to ${email}`);
      setInviteOpen(false);
      setName("");
      setEmail("");
      setDepartment("");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : isRtl
            ? "فشل في إرسال دعوة المستخدم"
            : "Failed to invite user",
      );
    },
  });

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error(isRtl ? "الاسم والبريد الإلكتروني مطلوبان" : "Name and email are required");
      return;
    }
    inviteMutation.mutate();
  };

  const roleLabelMap: Record<string, string> = {
    admin: isRtl ? "مدير" : "Admin",
    instructor: isRtl ? "محاضر" : "Instructor",
    member: isRtl ? "عضو" : "Member",
    student: isRtl ? "طالب" : "Student",
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={isRtl ? "النظام" : "System"}
        title={isRtl ? "إدارة المستخدمين" : "Users"}
        description={
          isRtl
            ? "إدارة أعضاء الفريق، أعضاء هيئة التدريس، والطلاب عبر مساحة العمل."
            : "Manage teammates, faculty, and students across your workspace."
        }
        actions={
          <Button
            onClick={() => setInviteOpen(true)}
            className="gradient-primary text-primary-foreground shadow-glow gap-1.5 cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            <span>{isRtl ? "دعوة مستخدم جديد" : "Invite user"}</span>
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-36 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <GlassCard className="p-2">
          <ul className="divide-y divide-border/60">
            {users.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="gradient-primary text-xs font-semibold text-primary-foreground">
                    {p.initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.email} {p.department ? `· ${p.department}` : ""}
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className="border-border/70 bg-background/60 capitalize text-xs"
                >
                  {roleLabelMap[p.role] || p.role}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs cursor-pointer"
                  onClick={() =>
                    toast.info(
                      isRtl ? `إدارة صلاحيات ${p.name}` : `Managing permissions for ${p.name}`,
                    )
                  }
                >
                  {isRtl ? "إدارة" : "Manage"}
                </Button>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <div className="text-center text-xs text-muted-foreground">
        <UsersIcon className="mr-1 inline h-3 w-3" />
        <span>
          {isRtl
            ? `${users.length} أعضاء في مساحة العمل التعليمية`
            : `${users.length} members in workspace`}
        </span>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md" dir={isRtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              <span>{isRtl ? "دعوة إلى مساحة العمل" : "Invite to Workspace"}</span>
            </DialogTitle>
            <DialogDescription>
              {isRtl
                ? "منح صلاحيات الوصول لمعالجة التسجيلات الصوتية، بطاقات استذكار المحاضرات، وملخصات الاجتماعات."
                : "Grant access to recording intelligence, lecture study decks, and meeting summaries."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleInviteSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>{isRtl ? "الاسم الكامل" : "Full Name"}</Label>
              <Input
                placeholder={isRtl ? "مثال: د. محمد أحمد" : "e.g. Jordan Hayes"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>{isRtl ? "البريد الإلكتروني" : "Email Address"}</Label>
              <Input
                type="email"
                placeholder={isRtl ? "user@example.com" : "jordan@acme.edu"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>{isRtl ? "القسم / التخصص" : "Department"}</Label>
              <Input
                placeholder={isRtl ? "مثال: علوم الحاسب" : "e.g. Computer Science"}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{isRtl ? "الدور / الصلاحية" : "Role"}</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{isRtl ? "مدير نظام" : "Admin"}</SelectItem>
                  <SelectItem value="instructor">{isRtl ? "محاضر" : "Instructor"}</SelectItem>
                  <SelectItem value="member">{isRtl ? "عضو" : "Member"}</SelectItem>
                  <SelectItem value="student">{isRtl ? "طالب" : "Student"}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>
                {isRtl ? "إلغاء" : "Cancel"}
              </Button>
              <Button
                type="submit"
                disabled={inviteMutation.isPending}
                className="gradient-primary text-primary-foreground shadow-glow"
              >
                {inviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isRtl ? (
                  "إرسال الدعوة"
                ) : (
                  "Send Invite"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
