#include "NPC/NPCNeedsComponent.h"

float UNPCNeedsComponent::Simulate(double Hours, ENeonActivity Activity)
{
	const float H = (float)Hours;
	float Earned = 0.f;
	Hunger = FMath::Clamp(Hunger - H / 7.f, 0.f, 1.f);
	Social = FMath::Clamp(Social - H / 30.f, 0.f, 1.f);
	Fun = FMath::Clamp(Fun - H / 26.f, 0.f, 1.f);
	switch (Activity)
	{
	case ENeonActivity::Sleep: Energy = FMath::Clamp(Energy + H / 7.f, 0.f, 1.f); Hunger = FMath::Clamp(Hunger + H / 14.f, 0.f, 1.f); break;
	case ENeonActivity::Work:
		Energy = FMath::Clamp(Energy - H / 12.f, 0.f, 1.f);
		if (bEmployed) { Earned = HourlyWage * H; Money += Earned; }
		Social = FMath::Clamp(Social + H / 20.f, 0.f, 1.f);
		break;
	case ENeonActivity::Socialize: case ENeonActivity::TalkToPlayer:
		Social = FMath::Clamp(Social + H * 1.2f, 0.f, 1.f); Fun = FMath::Clamp(Fun + H / 3.f, 0.f, 1.f); Energy -= H / 20.f; break;
	case ENeonActivity::Leisure: Fun = FMath::Clamp(Fun + H / 2.f, 0.f, 1.f); Energy -= H / 20.f; break;
	case ENeonActivity::JobHunt: Energy -= H / 14.f; Fun -= H / 20.f; break;
	default: Energy -= H / 18.f; break;
	}
	Energy = FMath::Clamp(Energy, 0.f, 1.f); Fun = FMath::Clamp(Fun, 0.f, 1.f);
	return Earned;
}
