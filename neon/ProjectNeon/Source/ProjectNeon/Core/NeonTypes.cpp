#include "Core/NeonTypes.h"

FString NeonTime::Ago(double NowHours, double ThenHours)
{
	const double Minutes = FMath::Max(0.0, (NowHours - ThenHours) * 60.0);
	if (Minutes < 2) return TEXT("just now");
	if (Minutes < 8) return TEXT("a few minutes ago");
	if (Minutes < 20) return TEXT("about ten minutes ago");
	if (Minutes < 45) return TEXT("about half an hour ago");
	if (Minutes < 90) return TEXT("about an hour ago");
	if (NeonTime::Day(NowHours) == NeonTime::Day(ThenHours))
	{
		const float H = NeonTime::HourOfDay(ThenHours);
		return H < 12 ? TEXT("this morning") : H < 17 ? TEXT("this afternoon") : TEXT("earlier this evening");
	}
	if (NeonTime::Day(NowHours) - NeonTime::Day(ThenHours) == 1) return TEXT("yesterday");
	return FString::Printf(TEXT("%d days ago"), NeonTime::Day(NowHours) - NeonTime::Day(ThenHours));
}

FString NeonTime::ActivityName(ENeonActivity A)
{
	switch (A)
	{
	case ENeonActivity::Sleep: return TEXT("sleeping");
	case ENeonActivity::Commute: return TEXT("commuting");
	case ENeonActivity::Work: return TEXT("working");
	case ENeonActivity::Lunch: return TEXT("having lunch");
	case ENeonActivity::Leisure: return TEXT("relaxing");
	case ENeonActivity::Shop: return TEXT("shopping");
	case ENeonActivity::Socialize: return TEXT("chatting with a friend");
	case ENeonActivity::JobHunt: return TEXT("looking for a job");
	case ENeonActivity::Wander: return TEXT("taking a walk");
	case ENeonActivity::Investigate: return TEXT("checking out what happened");
	case ENeonActivity::Flee: return TEXT("getting away from danger");
	case ENeonActivity::CallEmergency: return TEXT("calling emergency services");
	case ENeonActivity::Confront: return TEXT("confronting someone");
	case ENeonActivity::TalkToPlayer: return TEXT("talking to you");
	default: return TEXT("standing around");
	}
}
