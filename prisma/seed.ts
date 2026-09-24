import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.create({
    data: {
      name: "Alex Morgan",
      email: "admin@example.com",
      passwordHash: await bcrypt.hash("admin123", 10),
      role: "ADMIN",
    },
  });

  const manager = await prisma.user.create({
    data: {
      name: "Jordan Lee",
      email: "manager@example.com",
      passwordHash: await bcrypt.hash("manager123", 10),
      role: "MANAGER",
    },
  });

  const apartment = await prisma.property.create({
    data: {
      name: "Maple Court Apartment",
      category: "APARTMENT",
      address: "123 Maple St",
      city: "Springfield",
      dimension: 850,
      bedrooms: 2,
      bathrooms: 1,
      price: 1450,
      status: "OCCUPIED",
      notes: "2 bed / 1 bath walk-up.",
    },
  });

  const villa = await prisma.property.create({
    data: {
      name: "Birchwood Villa",
      category: "VILLA",
      address: "48 Birchwood Ave",
      city: "Springfield",
      dimension: 320,
      bedrooms: 4,
      bathrooms: 3,
      price: 685000,
      status: "VACANT",
      notes: "Standalone 4-bedroom villa with private garden.",
    },
  });

  const office = await prisma.property.create({
    data: {
      name: "Cedar Business Center",
      category: "OFFICE",
      address: "220 Cedar Blvd",
      city: "Springfield",
      dimension: 4000,
      price: 6000,
      status: "OCCUPIED",
      notes: "Ground-floor office suite, quarterly billing.",
    },
  });

  const jamie = await prisma.tenant.create({
    data: {
      firstName: "Jamie",
      lastName: "Rivera",
      email: "jamie.rivera@example.com",
      phone: "555-0142",
      company: "Rivera Consulting",
      idNumber: "P0234567",
      address: "77 Oakwood Dr",
      city: "Springfield",
    },
  });

  const karim = await prisma.tenant.create({
    data: {
      firstName: "Karim",
      lastName: "Haddad",
      email: "karim@haddadtrading.example",
      phone: "555-0198",
      company: "Haddad Trading",
      address: "9 Commerce Way",
      city: "Springfield",
    },
  });

  // Monthly lease: paid Jan-Aug in one lump sum, then a partial payment for
  // September — demonstrates flexible, non-period-aligned cash payments.
  const apartmentLease = await prisma.lease.create({
    data: {
      propertyId: apartment.id,
      tenantId: jamie.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      rentAmount: 1450,
      billingFrequency: "MONTHLY",
      depositAmount: 1450,
      status: "ACTIVE",
    },
  });

  await prisma.payment.create({
    data: {
      leaseId: apartmentLease.id,
      amount: 11600,
      date: new Date("2026-01-03"),
      method: "bank transfer",
      notes: "Covers January through August.",
      recordedById: manager.id,
    },
  });

  await prisma.payment.create({
    data: {
      leaseId: apartmentLease.id,
      amount: 950,
      date: new Date("2026-09-05"),
      method: "bank transfer",
      notes: "Partial payment toward September.",
      recordedById: manager.id,
    },
  });

  // Quarterly lease paid well in advance — demonstrates the advance-rent
  // credit (negative balance) rather than an amount owed.
  const officeLease = await prisma.lease.create({
    data: {
      propertyId: office.id,
      tenantId: karim.id,
      startDate: new Date("2026-07-01"),
      endDate: new Date("2027-06-30"),
      rentAmount: 6000,
      billingFrequency: "QUARTERLY",
      depositAmount: 6000,
      status: "ACTIVE",
    },
  });

  await prisma.payment.create({
    data: {
      leaseId: officeLease.id,
      amount: 10000,
      date: new Date("2026-07-05"),
      method: "wire transfer",
      notes: "Advance payment covering Q1 and part of Q2.",
      recordedById: manager.id,
    },
  });

  await prisma.expense.create({
    data: {
      propertyId: apartment.id,
      category: "MAINTENANCE",
      amount: 240,
      date: new Date("2026-08-14"),
      description: "Plumbing repair",
      recordedById: manager.id,
    },
  });

  await prisma.expense.create({
    data: {
      propertyId: villa.id,
      category: "TAXES",
      amount: 3200,
      date: new Date("2026-07-01"),
      description: "Annual property tax",
      recordedById: manager.id,
    },
  });

  await prisma.expense.create({
    data: {
      propertyId: office.id,
      category: "UTILITIES",
      amount: 180,
      date: new Date("2026-09-01"),
      description: "Electricity, September",
      recordedById: manager.id,
    },
  });

  console.log("Seed data created.");
  console.log("Login with admin@example.com / admin123 or manager@example.com / manager123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
